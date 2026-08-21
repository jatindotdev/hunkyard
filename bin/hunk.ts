#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { version } from '../package.json';
import { startServer } from '../server/index';
import {
  CliError,
  HELP,
  parseArgs,
  resolveViewerPath,
  viewerUrl,
} from './cli-core';

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
// silent, so `hunk` works in a repository on a machine without gh.
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
  repoRoot?: string;
}

// Whether the thing on this port is one of ours, and what it is serving.
async function describeExistingServer(port: number): Promise<HealthBody | null> {
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

async function main(): Promise<void> {
  let options;
  let viewer;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
      return;
    }
    if (options.version) {
      process.stdout.write(`${version}\n`);
      return;
    }
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

  const url = viewerUrl(options.port, viewer.path);

  // Running `hunk` twice is a normal thing to do, so a server of ours already
  // on this port is reused rather than treated as a busy port.
  const existing = await describeExistingServer(options.port);
  if (existing != null) {
    if (
      viewer.kind === 'local' &&
      existing.repoRoot != null &&
      repoRoot != null &&
      resolve(existing.repoRoot) !== resolve(repoRoot)
    ) {
      fail(
        `a hunk server on port ${options.port} is serving a different repository`,
        `It is serving:  ${existing.repoRoot}\nYou are in:     ${repoRoot}\n\nStop it, or use --port for a second one.`
      );
    }
    process.stdout.write(
      `Reusing the hunk server on port ${options.port}\n${url}\n`
    );
    if (options.open) openBrowser(url);
    return;
  }

  if (!(await isPortFree(options.port))) {
    fail(
      `port ${options.port} is in use by something else`,
      'Use --port to pick another. The port is fixed by default so the browser origin stays stable and your drafts and preferences survive a restart.'
    );
  }

  // Read here and set for the server, which runs in this same process: the
  // token is never handed to the browser, only proxied on its behalf.
  const token = resolveGitHubToken();
  process.env.HUNKYARD_REPO_ROOT = repoRoot ?? '';
  if (token != null) process.env.HUNKYARD_GITHUB_TOKEN = token;

  let server;
  try {
    server = startServer({ port: options.port });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const where =
    viewer.kind === 'local'
      ? `${repoRoot}  ·  ${options.target ?? 'working tree'}`
      : viewer.path.replace(/^\//, '');
  process.stdout.write(`\n  hunkyard   ${url}\n  reviewing  ${where}\n`);
  if (token == null && viewer.kind === 'github') {
    process.stdout.write(
      `\n  No GitHub token found. Public pull requests will work; private ones need\n  \`gh auth login\`, or GH_TOKEN in your environment.\n`
    );
  }
  process.stdout.write(`\n  Ctrl-C to stop\n\n`);

  if (options.open) openBrowser(url);

  const stop = () => {
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
