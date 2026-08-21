#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

import { version } from '../package.json';
import {
  ensureControlToken,
  listRepos,
  registerRepo,
} from '../lib/repos/registry';
import { startServer } from '../server/index';
import {
  CliError,
  HELP,
  parseArgs,
  resolveViewerPath,
  viewerUrl,
} from './cli-core';

// Set by the parent when it re-launches itself detached, so the child knows to
// serve rather than spawn another child.
const SERVE_ENV = 'HUNKYARD_SERVE';

function fail(message: string, hint?: string): never {
  process.stderr.write(`hunk: ${message}\n`);
  if (hint != null) process.stderr.write(`\n${hint}\n`);
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
function serve(port: number): void {
  let server;
  try {
    server = startServer({ port });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const stop = () => {
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// A compiled executable is its own execPath and needs no script argument. Run
// from a checkout, execPath is bun itself, so the entry has to be named.
function selfCommand(): string[] {
  const compiled = import.meta.path.startsWith('/$bunfs/');
  return compiled ? [process.execPath] : [process.execPath, import.meta.path];
}

// Re-launches this executable detached, so the terminal is free and the server
// outlives the shell that started it.
async function startBackgroundServer(port: number): Promise<void> {
  const [command, ...args] = selfCommand();
  const child = spawn(command as string, args, {
    env: { ...process.env, [SERVE_ENV]: String(port) },
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
  const health = await describeServer(port);
  if (health == null) {
    process.stdout.write(`No hunk server on port ${port}.\n`);
    return;
  }

  const repos = await listRepos();
  process.stdout.write(
    `hunk ${version} on http://127.0.0.1:${port}\n\n` +
      `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}\n`
  );
  for (const repo of repos) {
    process.stdout.write(`  ${repo.id.padEnd(28)} ${repo.root}\n`);
  }
}

async function runStop(port: number): Promise<void> {
  const health = await describeServer(port);
  if (health == null) {
    process.stdout.write(`No hunk server on port ${port}.\n`);
    return;
  }

  // Asking the server to stop itself would need an authenticated endpoint that
  // exists for nothing else, so the pid is found the same way anything else
  // finds what holds a port.
  const listing = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  const pids = listing.stdout
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);

  if (pids.length === 0) {
    fail(
      `could not find the process listening on port ${port}`,
      'It answered a health check, so something is there. Stop it by hand.'
    );
  }
  for (const pid of pids) process.kill(pid, 'SIGTERM');
  process.stdout.write(`Stopped the hunk server on port ${port}.\n`);
}

async function main(): Promise<void> {
  // The detached child re-enters here with nothing to do but serve.
  const inherited = process.env[SERVE_ENV];
  if (inherited != null && inherited !== '') {
    serve(Number(inherited));
    return;
  }

  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) fail(error.message, error.hint);
    throw error;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.version) {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (options.command === 'status') return runStatus(options.port);
  if (options.command === 'stop') return runStop(options.port);

  let viewer;
  try {
    viewer = resolveViewerPath(options.target);
  } catch (error) {
    if (error instanceof CliError) fail(error.message, error.hint);
    throw error;
  }

  // Only a local target needs a repository; a pull request does not.
  const repoRoot = git(['rev-parse', '--show-toplevel']);
  if (viewer.kind === 'local' && repoRoot == null) {
    fail(
      `${process.cwd()} is not inside a git repository`,
      'Run hunk from a repository, or pass a pull request like owner/repo#123.'
    );
  }

  // The token has to be in the server's environment, and the server may be a
  // process that is already running. So it is read before either branch below,
  // and a running server keeps whatever it started with.
  const token = resolveGitHubToken();
  if (token != null) process.env.HUNKYARD_GITHUB_TOKEN = token;
  const controlToken = await ensureControlToken();

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
  const url = viewerUrl(
    options.port,
    viewer.kind === 'local' && repo != null
      ? `${viewer.path}?repo=${encodeURIComponent(repo.id)}`
      : viewer.path
  );

  if (options.foreground) {
    process.stdout.write(`\n  hunkyard   ${url}\n`);
    if (repo != null) process.stdout.write(`  reviewing  ${repo.root}\n`);
    process.stdout.write(`\n  Ctrl-C to stop\n\n`);
    if (options.open) openBrowser(url);
    serve(options.port);
    return;
  }

  if (running == null) {
    await startBackgroundServer(options.port);
  } else if (controlToken != null && repoRoot != null) {
    // Belt and braces: the running server reads the registry from disk, so this
    // only matters if it ever caches it.
    await fetch(`http://127.0.0.1:${options.port}/api/repos`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hunkyard-token': controlToken,
      },
      body: JSON.stringify({ path: repoRoot }),
    }).catch(() => undefined);
  }

  process.stdout.write(`${url}\n`);
  if (token == null && viewer.kind === 'github') {
    process.stdout.write(
      `\nNo GitHub token found. Public pull requests will work; private ones need\n\`gh auth login\`, or GH_TOKEN in your environment.\n`
    );
  } else if (token != null && running?.github === false) {
    // Signing in to gh after the server started leaves it without the token,
    // which otherwise shows up as a pull request mysteriously failing to load.
    process.stdout.write(
      `\nThe running server started without a GitHub token and cannot pick this one\nup. Run \`hunk stop\` first if you need private pull requests.\n`
    );
  }
  if (options.open) openBrowser(url);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
