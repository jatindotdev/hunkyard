#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

import { runMain } from 'citty';

import { version } from '../package.json';
import { forwardAdoptedSockets } from '../lib/proxy/adopted';
import { inheritedSockets } from '../lib/service/activation';
import { createIdleTimer, idleTimeoutFromEnv } from '../lib/service/idle';
import { assertKnownFlags, buildCommands, selectCommand } from './commands';
import {
  isHelpCommand,
  serviceHelp,
  topLevelHelp,
  wantsTopLevelHelp,
} from './help';
import {
  installService,
  serviceIsRegistered,
  uninstallService,
} from './service';
import { runUpdate } from './update';
import { BARE_ORIGIN, ensureBareUrlProbe } from '../lib/proxy/canonical';
import { BARE_PORT, isSupportedPlatform } from '../lib/proxy/service';
import {
  clearDaemonPid,
  listDaemonPorts,
  readDaemonRecord,
  writeDaemonPid,
} from '../lib/repos/daemonPid';
import { registerRepo, tidyRepos } from '../lib/repos/registry';
import { startServer } from '../server/index';
import {
  CliError,
  DEFAULT_PORT,
  resolveReviewOrigin,
  resolveViewerPath,
} from './cli-core';
import { bold, cyan, dim, errorPrefix, green, row, yellow } from './style';

function fail(message: string, hint?: string): never {
  process.stderr.write(`${errorPrefix()} ${message}\n`);
  if (hint != null) process.stderr.write(`\n${dim(hint)}\n`);
  process.exit(1);
}

function git(args: readonly string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error != null) {
    fail(
      'git is not available on PATH',
      'hunk shells out to git to read your repository.'
    );
  }
  return result.status === 0 ? result.stdout.trim() : null;
}

// A token is optional: local targets never need one. Failing to find one is
// silent, so hunk works in a repository on a machine without gh.
function resolveGitHubToken(): string | null {
  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (fromEnv != null && fromEnv.trim() !== '') return fromEnv.trim();
  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  const token = result.status === 0 ? result.stdout.trim() : '';
  return token === '' ? null : token;
}


interface HealthBody {
  app?: string;
  // When the answering process started serving. A server keeps running the
  // binary it was launched with, so this is how a rebuilt hunk on disk is told
  // apart from the hunk actually answering.
  startedAt?: string;
  repos?: number;
  // Whether the running server has a GitHub token. It took its environment from
  // whichever invocation started it, so a token found now may not be one it has.
  github?: boolean;
}

interface RunningServer {
  pid: number;
  healthUrl: string;
  // Where you would actually reach it. The registered URL for an activated
  // server; the port it was given for one run by hand.
  origin: string;
}

// The server that is running, if one is.
//
// By pid file rather than by connecting, and that is not an optimisation: the
// service manager starts the server when something connects to the registered
// port, so asking it whether anything is running would be what makes something
// run. An activated server also picks an ephemeral port, so there is no port to
// ask on -- only the pid it recorded under the registered one.
async function findRunningServer(port: number): Promise<RunningServer | null> {
  const activated = await readDaemonRecord(BARE_PORT);
  if (activated != null) {
    // Straight to the server rather than through the registered socket.
    // Connections through that socket are what keeps it from going idle, so
    // asking after it that way would be a status check that kept alive the
    // server it was reporting on -- and checking twice would keep it up for
    // good.
    return {
      pid: activated.pid,
      healthUrl: `http://127.0.0.1:${activated.port}/api/health`,
      origin: BARE_ORIGIN,
    };
  }

  // Whatever port it was given, rather than the one this invocation happens to
  // have been told about. A server run by hand chooses its own.
  const ports = await listDaemonPorts();
  const found = ports.includes(port) ? port : ports[0];
  if (found == null) return null;

  const record = await readDaemonRecord(found);
  if (record == null) return null;

  return {
    pid: record.pid,
    healthUrl: `http://127.0.0.1:${record.port}/api/health`,
    origin: `${BARE_ORIGIN}:${found}`,
  };
}

async function describeServer(
  running: RunningServer | null
): Promise<HealthBody | null> {
  if (running == null) return null;
  try {
    const response = await fetch(running.healthUrl, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as HealthBody;
    return body?.app === 'hunkyard' ? body : null;
  } catch {
    return null;
  }
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command as string, args as string[], {
    stdio: 'ignore',
    detached: true,
  });
  // No browser opener is not an error; the URL is printed either way.
  child.on('error', () => {});
  child.unref();
}

// Runs the server in this process until stopped. This is what --foreground does
// in the terminal, and what the service manager starts on a connection.
async function serve(options: {
  port: number;
  activated: boolean;
}): Promise<void> {
  const inherited = options.activated ? inheritedSockets() : [];
  if (options.activated && inherited.length === 0) {
    fail(
      'started with --activated but no socket was handed over',
      'This is the form the service manager runs. Use `hunk service run` to run\none in a terminal.'
    );
  }

  // Behind an inherited socket the port is nobody's business but ours, so it is
  // ephemeral: a fixed one could collide with something, and no client ever
  // names it.
  const port = inherited.length > 0 ? 0 : options.port;

  let server;
  try {
    server = startServer({ port });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const stop = () => {
    server.stop();
    // Filed under the registered port when activated, under its own otherwise.
    const filedUnder = inherited.length > 0 ? BARE_PORT : server.port;
    void clearDaemonPid(filedUnder).finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (inherited.length === 0) {
    // Run by hand, so it says where it is and how to stop it. Nothing else
    // prints this: the registered URL is normally what people use, and this is
    // the path for someone who has not registered it or is debugging.
    await writeDaemonPid(server.port);
    process.stdout.write(
      `\n${row('hunkyard', bold(cyan(`${BARE_ORIGIN}:${server.port}`)))}` +
        `\n  ${dim('Ctrl-C to stop')}\n\n`
    );
    return;
  }

  // Exiting is not going away: the service manager still holds the socket, so
  // the next connection starts this again. Running only while something is
  // connected is what keeps hunkyard out of your login items doing nothing.
  const idle = createIdleTimer({
    afterMs: idleTimeoutFromEnv(),
    onExpired: stop,
  });
  const forwarder = forwardAdoptedSockets({
    fds: inherited,
    to: server.port,
    onActivity: idle.touch,
  });
  void forwarder;
  await writeDaemonPid(BARE_PORT, server.port);
  // Armed from the start, so a server nobody then talks to does not stay up
  // waiting to be spoken to for the first time.
  idle.touch();
}

// What is registered, what is running, and whether it is current.
//
// Nothing running is the normal state now, not a fault: the service manager
// holds the socket, and a request is what starts a server.
async function runStatus(port: number): Promise<void> {
  const running = await findRunningServer(port);
  const health = await describeServer(running);
  const registered = await serviceIsRegistered();

  // The pid decides whether it is running; health only adds detail. A server
  // that is up but slow to answer is still up, and reporting it idle would send
  // you looking for a problem that is not there.
  process.stdout.write(
    running == null
      ? `${dim(`hunk ${version}`)}  ${dim('●')} ${dim('idle')}\n`
      : `${dim(`hunk ${version}`)}  ${green('●')} ${bold(cyan(running.origin))}\n`
  );

  process.stdout.write(
    registered
      ? row('url', `${green(BARE_ORIGIN)} ${dim('registered')}`)
      : row('url', `${yellow('not registered')} ${dim('hunk service install')}`)
  );

  if (isStale(health)) {
    process.stdout.write(
      row(
        'version',
        `${yellow('stale')} ${dim('this binary is newer; hunk service stop')}`
      )
    );
  }

  // The list lives on disk rather than in the server, so it is worth showing
  // either way, and tidying it here is what drops a repository that is gone.
  const repos = await tidyRepos();
  if (repos.length === 0) {
    process.stdout.write(
      `\n${dim('No repositories yet. Run hunk inside one, or open one from the browser.')}\n`
    );
    return;
  }
  process.stdout.write(
    `\n${dim(`${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}`)}\n`
  );
  for (const repo of repos) {
    process.stdout.write(`  ${cyan(repo.id.padEnd(28))} ${dim(repo.root)}\n`);
  }
  process.stdout.write(
    `\n${dim('The opener has a button per repository for dropping one from this list.')}\n`
  );
}

// Whether the answering server predates the binary being run right now.
//
// A process keeps the executable image it was started with, so replacing the
// file on disk changes nothing about what is already running -- and nothing in
// the output would say so, which is how you end up debugging a fix that is not
// the code answering your requests. Stopping is the whole remedy: the next
// request starts a server on the new binary.
function isStale(health: HealthBody | null): boolean {
  if (health?.startedAt == null) return false;
  const started = Date.parse(health.startedAt);
  if (Number.isNaN(started)) return false;
  try {
    return statSync(process.execPath).mtimeMs > started;
  } catch {
    return false;
  }
}

// Stops whatever of ours is serving. Returns whether there was anything to
// stop, so a caller that is only clearing the way can say nothing.
async function stopServer(port: number): Promise<boolean> {
  const running = await findRunningServer(port);
  if (running == null) {
    // readDaemonPid already drops a file whose process is gone, so there is
    // nothing left to tidy here.
    return false;
  }

  try {
    process.kill(running.pid, 'SIGTERM');
  } catch {
    // Gone between reading the pid file and here.
    return false;
  }
  await clearDaemonPid(port);
  await clearDaemonPid(BARE_PORT);
  return true;
}

async function runStop(port: number): Promise<void> {
  if (!(await stopServer(port))) {
    process.stdout.write(`${dim('Nothing is running.')}\n`);
    return;
  }
  // Only a registered URL brings it back; a server run by hand stays stopped.
  process.stdout.write(
    (await serviceIsRegistered())
      ? `${green('✓')} ${dim('stopped; the next request starts a new one')}\n`
      : `${green('✓')} ${dim('stopped')}\n`
  );
}

async function requireCanonicalOrigin(port: number): Promise<string> {
  // A server someone started by hand is a perfectly good place to send them,
  // and telling them to register a URL while their own server is answering
  // would be advice they do not need.
  const running = await findRunningServer(port);
  if (running != null) return running.origin;

  const resolved = resolveReviewOrigin({
    port,
    bareReachable: await ensureBareUrlProbe(),
  });
  if (resolved.kind === 'origin') return resolved.origin;
  fail(
    `${BARE_ORIGIN} is not being served yet`,
    'Run `hunk service install` once. It registers the URL and needs sudo the one\ntime. `hunk service run` runs one in this terminal on a port instead.'
  );
}

// The port is the registered one, always. Reviewing does not start a server, so
// naming a different port here would only change the URL printed -- pointing it
// at nothing, or at whatever else happens to be listening there.
async function review(options: {
  target?: string;
  open: boolean;
}): Promise<void> {
  let viewer;
  try {
    viewer = resolveViewerPath(options.target);
  } catch (error) {
    if (error instanceof CliError) fail(error.message, error.hint);
    throw error;
  }

  // Only a local target needs a repository; a pull request does not. Being
  // outside one is no longer an error: the opener is a page now, so there is
  // somewhere to send you.
  const repoRoot = git(['rev-parse', '--show-toplevel']);
  const opener = viewer.kind === 'local' && repoRoot == null;
  if (opener && options.target != null) {
    fail(
      `${process.cwd()} is not inside a git repository`,
      `\`${options.target}\` can only be a local revspec here. Run hunk from a repository, or pass a pull request like owner/repo#123.`
    );
  }

  // The token has to be in the server's environment, and the server may be a
  // process that is already running. So it is read before either branch below,
  // and a running server keeps whatever it started with.
  const token = resolveGitHubToken();
  if (token != null) process.env.HUNKYARD_GITHUB_TOKEN = token;


  // Registered before the browser opens, so the page can address it as soon as
  // it loads. A running server reads the registry per request, so it picks this
  // up without being told.
  const repo = repoRoot == null ? null : await registerRepo(repoRoot);
  const path = opener
    ? '/'
    : viewer.kind === 'local' && repo != null
      ? `${viewer.path}?repo=${encodeURIComponent(repo.id)}`
      : viewer.path;

  // Nothing is started here. The service manager holds the socket, so opening
  // the URL is what starts a server, and a `hunk` that spawned one as well
  // would be a second server racing the one the request is about to create.
  const url = `${await requireCanonicalOrigin(DEFAULT_PORT)}${path}`;

  process.stdout.write(`${bold(cyan(url))}\n`);
  if (token == null && viewer.kind === 'github') {
    process.stdout.write(
      `\n${dim('No GitHub token found. Public pull requests will work; private ones need')}\n${dim('`gh auth login`, or GH_TOKEN in your environment.')}\n`
    );
  }
  if (options.open) openBrowser(url);
}

// Wrapped rather than run at the top level: --bytecode compiles to CJS, which
// has no top-level await.
async function main(): Promise<void> {
  if (!isSupportedPlatform()) {
    fail(
      `hunkyard does not run on ${process.platform}`,
      'It needs a service manager that binds a privileged port and hands the\nsocket to an unprivileged process. macOS and Linux both do; nothing else\nis supported.'
    );
  }

  const { name, rawArgs } = selectCommand(process.argv.slice(2));

  // citty's own help for a command that named itself; ours for the top level,
  // which has to list the commands somewhere a reader will look.
  if (isHelpCommand(name) || (name === 'review' && wantsTopLevelHelp(rawArgs))) {
    process.stdout.write(topLevelHelp(version));
    return;
  }

  if (name === 'service') {
    const unknown = rawArgs[0];
    if (unknown != null && !unknown.startsWith('-')) {
      fail(`unknown service command ${unknown}`, serviceHelp());
    }
    process.stdout.write(serviceHelp());
    return;
  }

  const commands = buildCommands({
    fail,
    version,
    review,
    status: runStatus,
    stop: runStop,
    install: () => installService(),
    uninstall: () => uninstallService(),
    update: ({ check, port }) =>
      runUpdate({
        check,
        version,
        // Replacing the binary leaves the running server on the old one, so an
        // update that does not stop it is an update you are not running. There
        // is nothing to start: the next request does that.
        stopServer: () => void stopServer(port),
      }),
    serve: ({ port, activated }) => serve({ port, activated }),
  });

  const command = commands[name] as Parameters<typeof runMain>[0];
  assertKnownFlags(
    rawArgs,
    (command.args ?? {}) as Parameters<typeof assertKnownFlags>[1],
    fail
  );
  await runMain(command, { rawArgs });
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
