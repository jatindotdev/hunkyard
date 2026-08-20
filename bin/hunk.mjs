#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

import {
  CliError,
  DEFAULT_PORT,
  HELP,
  HOSTNAME,
  parseArgs,
  resolveViewerPath,
  viewerUrl,
} from './cli-core.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fail(message, hint) {
  process.stderr.write(`hunk: ${message}\n`);
  if (hint) process.stderr.write(`\n${hint}\n`);
  process.exit(1);
}

function readPackageVersion() {
  try {
    return JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
    ).version;
  } catch {
    return '0.0.0';
  }
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error != null) {
    fail(
      'git is not available on PATH',
      'hunk shells out to git to read your repository.'
    );
  }
  return result.status === 0 ? result.stdout.trim() : null;
}

function resolveRepoRoot() {
  return git(['rev-parse', '--show-toplevel'], process.cwd());
}

// A token is optional: local targets never need one. Failing to find one is
// silent, so `hunk` works in a repository on a machine without gh.
function resolveGitHubToken() {
  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (fromEnv != null && fromEnv.trim() !== '') {
    return { token: fromEnv.trim(), source: 'environment' };
  }
  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  const token = result.status === 0 ? result.stdout.trim() : '';
  return token === '' ? null : { token, source: 'gh' };
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function describeExistingServer(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.app === 'hunkyard' ? body : null;
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', () => {
    // No browser opener is not an error; the URL is printed either way.
  });
  child.unref();
}

async function waitForServer(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await describeExistingServer(port)) != null) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
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
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }

  let viewer;
  try {
    viewer = resolveViewerPath(options.target);
  } catch (error) {
    if (error instanceof CliError) fail(error.message, error.hint);
    throw error;
  }

  // Only a local target needs a repository; a pull request does not.
  const repoRoot = resolveRepoRoot();
  if (viewer.kind === 'local' && repoRoot == null) {
    fail(
      `${process.cwd()} is not inside a git repository`,
      'Run hunk from a repository, or pass a pull request like owner/repo#123.'
    );
  }

  const url = viewerUrl(options.port, viewer.path);

  // If our own server is already up for this repository, reuse it rather than
  // failing on a busy port -- running `hunk` twice is a normal thing to do.
  const existing = await describeExistingServer(options.port);
  if (existing != null) {
    if (
      viewer.kind === 'local' &&
      existing.repoRoot != null &&
      resolve(existing.repoRoot) !== resolve(repoRoot)
    ) {
      fail(
        `a hunk server on port ${options.port} is serving a different repository`,
        `It is serving:  ${existing.repoRoot}\nYou are in:     ${repoRoot}\n\nStop it, or use --port for a second one.`
      );
    }
    process.stdout.write(`Reusing the hunk server on port ${options.port}\n${url}\n`);
    if (options.open) openBrowser(url);
    return;
  }

  if (!(await isPortFree(options.port))) {
    fail(
      `port ${options.port} is in use by something else`,
      'Use --port to pick another. The port is fixed by default so the browser origin stays stable and your drafts and preferences survive a restart.'
    );
  }

  const nextBin = join(PACKAGE_ROOT, 'node_modules', '.bin', 'next');
  if (!existsSync(nextBin)) {
    fail(
      'could not find the bundled next binary',
      `Looked in ${nextBin}. If you are working on hunkyard itself, run pnpm install first.`
    );
  }

  const github = resolveGitHubToken();
  const env = {
    ...process.env,
    HUNKYARD_REPO_ROOT: repoRoot ?? '',
    // Kept out of the browser deliberately: the server holds it and proxies.
    ...(github == null ? {} : { HUNKYARD_GITHUB_TOKEN: github.token }),
    PORT: String(options.port),
  };

  const server = spawn(nextBin, ['start', '-p', String(options.port)], {
    cwd: PACKAGE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString('utf8');
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString('utf8');
  });

  const shutdown = () => {
    server.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('exit', (code) => {
    if (code !== 0 && code != null) {
      process.stderr.write(serverOutput);
      fail(`the server exited with code ${code}`);
    }
    process.exit(0);
  });

  if (!(await waitForServer(options.port))) {
    process.stderr.write(serverOutput);
    server.kill('SIGTERM');
    fail('the server did not come up');
  }

  const where =
    viewer.kind === 'local'
      ? `${repoRoot}  ·  ${options.target ?? 'working tree'}`
      : viewer.path.replace(/^\//, '');
  process.stdout.write(`\n  hunkyard   ${url}\n  reviewing  ${where}\n`);
  if (github == null && viewer.kind === 'github') {
    process.stdout.write(
      `\n  No GitHub token found. Public pull requests will work; private ones need\n  \`gh auth login\`, or GH_TOKEN in your environment.\n`
    );
  }
  process.stdout.write(`\n  Ctrl-C to stop\n\n`);

  if (options.open) openBrowser(url);

  // Hold the process open so Ctrl-C reaches us and stops the server too.
  createInterface({ input: process.stdin }).on('close', () => {});
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
