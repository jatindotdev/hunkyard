#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createServer } from 'node:net';

import { runMain } from 'citty';

import { version } from '../package.json';
import { startForwarder } from '../lib/proxy/forward';
import { forwardAdoptedSockets } from '../lib/proxy/adopted';
import { BARE_PORT } from '../lib/proxy/service';
import { inheritedSockets } from '../lib/service/activation';
import { createIdleTimer, idleTimeoutFromEnv } from '../lib/service/idle';
import { assertKnownFlags, buildCommands, selectCommand } from './commands';
import { topLevelHelp, wantsTopLevelHelp } from './help';
import {
  installService,
  serviceIsRegistered,
  uninstallService,
} from './service';
import { runUpdate } from './update';
import { BARE_ORIGIN, ensureBareUrlProbe } from '../lib/proxy/canonical';
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

function isPortFree(port: number): Promise<boolean> {
  return new Promise((settle) => {
    const probe = createServer();
    probe.once('error', () => settle(false));
    probe.once('listening', () => probe.close(() => settle(true)));
    probe.listen(port, '127.0.0.1');
  });
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

// Whether the thing on this port is one of ours.
async function describeServer(port: number): Promise<HealthBody | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
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
      'This is the form the service manager runs. Use `hunk --foreground` to serve\nin a terminal.'
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
    await writeDaemonPid(port);
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
  const health = await describeServer(port);
  const registered = await serviceIsRegistered();

  process.stdout.write(
    health == null
      ? `${dim(`hunk ${version}`)}  ${dim('●')} ${dim('idle')}\n`
      : `${dim(`hunk ${version}`)}  ${green('●')} ${bold(cyan(BARE_ORIGIN))}\n`
  );

  process.stdout.write(
    registered
      ? row('url', `${green(BARE_ORIGIN)} ${dim('registered')}`)
      : row('url', `${yellow('not registered')} ${dim('hunk install')}`)
  );

  if (isStale(health)) {
    process.stdout.write(
      row('version', `${yellow('stale')} ${dim('this binary is newer; hunk restart')}`)
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
  const health = await describeServer(port);
  if (health == null) {
    // Nothing is serving, so any pid recorded is from a server that was killed
    // rather than stopped. Left alone it accumulates one file per port used.
    await clearDaemonPid(port);
    await clearDaemonPid(BARE_PORT);
    return false;
  }

  // The server records its own pid, so stopping it needs nothing from the
  // system. lsof is the fallback: it is absent from minimal Linux images and
  // does not exist on Windows.
  const recorded =
    (await readDaemonPid(BARE_PORT)) ?? (await readDaemonPid(port));
  const pids =
    recorded != null
      ? [recorded]
      : spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
          encoding: 'utf8',
        })
          .stdout?.split('\n')
          .map((line) => Number(line.trim()))
          .filter((pid) => Number.isInteger(pid) && pid > 0) ?? [];

  if (pids.length === 0) return false;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone between the health check and here.
    }
  }
  await clearDaemonPid(port);
  await clearDaemonPid(BARE_PORT);
  return true;
}

// Restarting is only stopping. The service manager holds the socket either way,
// so the next request starts a fresh one -- which is the same thing a restart
// was ever for, and it now costs nothing when nobody asks.
async function runRestart(port: number): Promise<void> {
  const stopped = await stopServer(port);
  process.stdout.write(
    stopped
      ? `${green('✓')} ${dim('stopped; the next request starts the new one')}\n`
      : `${dim('Nothing was running. The next request starts the new one.')}\n`
  );
}

async function runStop(port: number): Promise<void> {
  process.stdout.write(
    (await stopServer(port))
      ? `${green('✓')} ${dim('stopped; it starts again on the next request')}\n`
      : `${dim('Nothing is running.')}\n`
  );
}

async function requireCanonicalOrigin(port: number): Promise<string> {
  const resolved = resolveReviewOrigin({
    port,
    bareReachable: await ensureBareUrlProbe(port),
  });
  if (resolved.kind === 'origin') return resolved.origin;
  fail(
    `${BARE_ORIGIN} is not being served yet`,
    'Run `hunk install` once. It starts the server at login and forwards port 80,\nwhich needs sudo the one time. `hunk --foreground` serves on the port instead.'
  );
}

async function review(options: {
  target?: string;
  port: number;
  open: boolean;
  foreground: boolean;
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

  // Only --foreground binds a port here; everything else goes through the
  // socket the service manager holds.
  if (
    options.foreground &&
    (await describeServer(options.port)) == null &&
    !(await isPortFree(options.port))
  ) {
    fail(
      `port ${options.port} is in use by something else`,
      'Use --port to pick another.'
    );
  }

  // Registered before the browser opens, so the page can address it as soon as
  // it loads. A running server reads the registry per request, so it picks this
  // up without being told.
  const repo = repoRoot == null ? null : await registerRepo(repoRoot);
  const path = opener
    ? '/'
    : viewer.kind === 'local' && repo != null
      ? `${viewer.path}?repo=${encodeURIComponent(repo.id)}`
      : viewer.path;

  if (options.foreground) {
    // The escape hatch, and the thing `hunk` tells you to run when the
    // background server will not start. It has to work with nothing installed,
    // so it names the port and says what would remove it.
    const bare = await ensureBareUrlProbe(options.port);
    const url = `${bare ? BARE_ORIGIN : `${BARE_ORIGIN}:${options.port}`}${path}`;
    process.stdout.write(`\n${row('hunkyard', bold(cyan(url)))}`);
    if (repo != null) process.stdout.write(row('reviewing', dim(repo.root)));
    if (!bare) {
      process.stdout.write(row('', dim('hunk install drops the port')));
    }
    process.stdout.write(`\n  ${dim('Ctrl-C to stop')}\n\n`);
    if (options.open) openBrowser(url);
    await serve({ port: options.port, activated: false });
    return;
  }

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
  if (name === 'review' && wantsTopLevelHelp(rawArgs)) {
    process.stdout.write(topLevelHelp(version));
    return;
  }

  const commands = buildCommands({
    fail,
    version,
    review,
    status: runStatus,
    stop: runStop,
    restart: runRestart,
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
        // update that does not restart is an update you are not running.
        restart: () => runRestart(port),
      }),
    serve: ({ port, activated }) => serve({ port, activated }),
    forward: async ({ from, to }) => {
      startForwarder({ from, to });
      process.stdout.write(`${dim(`forwarding ${from} to ${to}`)}\n`);
      // Held open by the listener; the service manager stops it.
      await new Promise(() => {});
    },
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
