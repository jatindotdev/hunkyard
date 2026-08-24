#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

import { runMain } from 'citty';

import { version } from '../package.json';
import { startForwarder } from '../lib/proxy/forward';
import { assertKnownFlags, buildCommands, selectCommand } from './commands';
import { topLevelHelp, wantsTopLevelHelp } from './help';
import { installService, uninstallService } from './service';
import {
  AGENT_LABEL,
  agentInstallState,
  agentLogPath,
} from '../lib/service/agent';
import { canonicalOrigin } from '../lib/proxy/canonical';
import {
  clearDaemonPid,
  readDaemonPid,
  writeDaemonPid,
} from '../lib/repos/daemonPid';
import { forgetRepos, registerRepo, tidyRepos } from '../lib/repos/registry';
import { startServer } from '../server/index';
import { CliError, resolveViewerPath, selfCommand } from './cli-core';
import { bold, cyan, dim, errorPrefix, green, red, row, yellow } from './style';

// Set on the detached child so it can tell that it is one. It says nothing
// about what to do -- that is `serve` on the argv -- it only stops a child that
// failed to reach `serve` from spawning a child of its own, forever.
const CHILD_ENV = 'HUNKYARD_CHILD';

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

async function waitForServer(port: number): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await describeServer(port)) != null) return true;
    await Bun.sleep(50);
  }
  return false;
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

// Runs the server in this process until stopped. This is what the detached
// child does, and what --foreground does in the terminal.
async function serve(port: number): Promise<void> {
  let server;
  try {
    server = startServer({ port });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  await writeDaemonPid(port);
  const stop = () => {
    server.stop();
    void clearDaemonPid(port).finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// Re-launches this executable detached, so the terminal is free and the server
// outlives the shell that started it. The same `serve` the login agent runs.
async function startBackgroundServer(port: number): Promise<void> {
  if (process.env[CHILD_ENV] != null) {
    // A child that reached this line did not land on `serve`, so re-running
    // itself is exactly what it just did. Without this the mistake is a fork
    // bomb rather than an error, which is how it presented the once it
    // happened: selfCommand named an entry the child read as a review target.
    fail(
      'the background server could not start itself',
      'Run `hunk --foreground` to serve in this terminal and see why.'
    );
  }

  const [command, ...args] = selfCommand(import.meta.path);
  const child = spawn(command as string, [...args, 'serve', '--port', String(port)], {
    env: { ...process.env, [CHILD_ENV]: '1' },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  if (!(await waitForServer(port))) {
    fail(
      'the server did not come up',
      'Run `hunk --foreground` to see what it says.'
    );
  }
}

async function runStatus(port: number): Promise<void> {
  // An installed agent decides the port, and it need not be the default, so it
  // is read back rather than assumed.
  const agent = await agentInstallState();
  const servingPort = agent.port ?? port;
  const health = await describeServer(servingPort);
  const canonical = await canonicalOrigin(servingPort);

  process.stdout.write(
    health == null
      ? `${dim(`hunk ${version}`)}  ${red('●')} nothing on port ${servingPort}\n`
      : `${dim(`hunk ${version}`)}  ${green('●')} ${bold(cyan(canonical))}\n`
  );

  process.stdout.write(
    agent.installed
      ? row('at login', `${green('yes')} ${dim(`port ${agent.port ?? port}`)}`)
      : row('at login', `${yellow('no')} ${dim('hunk install')}`)
  );
  // Only when the file is there and nothing answers: otherwise this is a
  // subprocess on every status for no reason.
  if (agent.installed && health == null && process.platform === 'darwin') {
    const printed = spawnSync(
      'launchctl',
      ['print', `gui/${process.getuid?.() ?? ''}/${AGENT_LABEL}`],
      { encoding: 'utf8' }
    );
    const state = /state = (\S+)/.exec(printed.stdout ?? '')?.[1];
    process.stdout.write(
      row('launchd', `${yellow(state ?? 'not loaded')} ${dim(agentLogPath())}`)
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

async function runStop(port: number): Promise<void> {
  const health = await describeServer(port);
  if (health == null) {
    // Nothing is serving, so any pid recorded for this port is from a server
    // that was killed rather than stopped. Left alone it accumulates one file
    // per port ever used.
    await clearDaemonPid(port);
    process.stdout.write(`${dim(`No hunk server on port ${port}.`)}\n`);
    return;
  }

  // The server records its own pid, so stopping it needs nothing from the
  // system. lsof is the fallback, for a daemon started by an older build: it is
  // absent from minimal Linux images and does not exist on Windows.
  const recorded = await readDaemonPid(port);
  const pids =
    recorded != null
      ? [recorded]
      : spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
          encoding: 'utf8',
        })
          .stdout?.split('\n')
          .map((line) => Number(line.trim()))
          .filter((pid) => Number.isInteger(pid) && pid > 0) ?? [];

  if (pids.length === 0) {
    fail(
      `could not find the process serving port ${port}`,
      'It answered a health check, so something is there. Stop it by hand.'
    );
  }
  for (const pid of pids) process.kill(pid, 'SIGTERM');
  await clearDaemonPid(port);
  process.stdout.write(`${green('✓')} stopped the server on port ${port}\n`);
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

  const running = await describeServer(options.port);
  if (running == null && !(await isPortFree(options.port))) {
    fail(
      `port ${options.port} is in use by something else`,
      'Use --port to pick another. The port is fixed by default so the browser origin stays stable and your viewed state and preferences survive a restart.'
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
  // The bare host when the forwarder answers, the port otherwise, so what is
  // printed is the origin the browser will end up on either way.
  const url = `${await canonicalOrigin(options.port)}${path}`;

  if (options.foreground) {
    process.stdout.write(`\n${row('hunkyard', bold(cyan(url)))}`);
    if (repo != null) process.stdout.write(row('reviewing', dim(repo.root)));
    process.stdout.write(`\n  ${dim('Ctrl-C to stop')}\n\n`);
    if (options.open) openBrowser(url);
    await serve(options.port);
    return;
  }

  if (running == null) {
    await startBackgroundServer(options.port);
  }

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
    install: (port) => installService(port),
    uninstall: () => uninstallService(),
    serve: (port) => serve(port),
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
