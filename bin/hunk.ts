#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

import { runMain } from 'citty';

import { version } from '../package.json';
import { forwardAdoptedSockets } from '../lib/proxy/adopted';
import { inheritedSockets } from '../lib/service/activation';
import { createIdleTimer, idleTimeoutFromEnv } from '../lib/service/idle';
import { assertKnownFlags, buildCommands, selectCommand } from './commands';
import { isHelpCommand, topLevelHelp, wantsTopLevelHelp } from './help';
import {
  installService,
  serviceIsRegistered,
  uninstallService,
} from './service';
import { runUpdate } from './update';
import { BARE_ORIGIN, ensureBareUrlProbe } from '../lib/proxy/canonical';
import { BARE_PORT, servicePlatform } from '../lib/proxy/service';
import {
  clearDaemonPid,
  readDaemonPid,
  writeDaemonPid,
} from '../lib/repos/daemonPid';
import { forgetRepos, registerRepo, tidyRepos } from '../lib/repos/registry';
import { startServer } from '../server/index';
import {
  CliError,
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
  const activated = await readDaemonPid(BARE_PORT);
  if (activated != null) {
    // Safe to ask now: it is already up, so the request starts nothing.
    return {
      pid: activated,
      healthUrl: `http://127.0.0.1:${BARE_PORT}/api/health`,
      origin: BARE_ORIGIN,
    };
  }

  const own = await readDaemonPid(port);
  if (own != null) {
    return {
      pid: own,
      healthUrl: `http://127.0.0.1:${port}/api/health`,
      origin: `${BARE_ORIGIN}:${port}`,
    };
  }

  return null;
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
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
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
      'This is the form the service manager runs. Use `hunk serve` to run one in\na terminal.'
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
    void clearDaemonPid(server.port).finally(() => process.exit(0));
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
    onBusy: idle.busy,
    onIdle: idle.idle,
  });
  void forwarder;
  await writeDaemonPid(BARE_PORT);
  // Nothing has connected yet on a cold start, and the connection that started
  // us is about to arrive; without arming this a server nobody then uses would
  // stay up forever.
  idle.idle();
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
      : row('url', `${yellow('not registered')} ${dim('hunk install')}`)
  );

  if (isStale(health)) {
    process.stdout.write(
      row('version', `${yellow('stale')} ${dim('this binary is newer; hunk stop')}`)
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
    `\n${dim('hunk forget <id> removes one from this list, --all removes every one.')}\n`
  );
}

// Whether the answering server predates the binary being run right now. A
// long-lived server keeps serving the code it started with, so rebuilding or
// upgrading changes nothing until it is restarted -- and nothing about the
// output says so, which is how you end up debugging a fix that is not running.
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
  const resolved = resolveReviewOrigin({
    port,
    bareReachable: await ensureBareUrlProbe(),
    canRegister: servicePlatform() !== 'unsupported',
  });
  if (resolved.kind === 'origin') return resolved.origin;
  fail(
    `${BARE_ORIGIN} is not being served yet`,
    'Run `hunk install` once. It registers the URL and needs sudo the one time.\n`hunk serve` runs one in this terminal on a port instead.'
  );
}

async function review(options: {
  target?: string;
  port: number;
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
  const url = `${await requireCanonicalOrigin(options.port)}${path}`;

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
  const { name, rawArgs } = selectCommand(process.argv.slice(2));

  // citty's own help for a command that named itself; ours for the top level,
  // which has to list the commands somewhere a reader will look.
  if (isHelpCommand(name) || (name === 'review' && wantsTopLevelHelp(rawArgs))) {
    process.stdout.write(topLevelHelp(version));
    return;
  }

  const commands = buildCommands({
    fail,
    version,
    review,
    status: runStatus,
    stop: runStop,
    forget: async ({ id, all }) => {
      if (id == null && !all) {
        fail(
          'name a repository id, or pass --all',
          'Run `hunk status` for the ids.'
        );
      }
      const removed = await forgetRepos(all ? undefined : id);
      process.stdout.write(
        removed === 0
          ? `${dim('Nothing to forget.')}\n`
          : `${green('✓')} forgot ${removed} ${removed === 1 ? 'repository' : 'repositories'} ${dim('(the repositories themselves are untouched)')}\n`
      );
    },
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
