import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { findRepoRoot } from '../git/exec';
import { repoIdFor } from './id';
import { stateDir } from './stateDir';

export interface RegisteredRepo {
  id: string;
  root: string;
  // When a `hunk` invocation last opened this repository, so `hunk status` can
  // show the useful ones first.
  lastUsedAt: string;
}

interface RegistryFile {
  repos?: RegisteredRepo[];
  defaultId?: string;
}

function registryPath(): string {
  return join(stateDir(), 'repos.json');
}

function controlTokenPath(): string {
  return join(stateDir(), 'control-token');
}

async function readFileJson(path: string): Promise<RegistryFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (parsed == null || typeof parsed !== 'object') return {};
    return parsed as RegistryFile;
  } catch {
    return {};
  }
}

// The secret that separates "a local process asked" from "a web page asked".
//
// Registering a repository means telling the daemon to read a directory, so it
// cannot be something any page that reaches the port can do. A CLI invocation
// can read this file; a browser cannot, and never needs to -- the client only
// ever addresses repositories that are already registered.
export async function readControlToken(): Promise<string | null> {
  try {
    const token = (await readFile(controlTokenPath(), 'utf8')).trim();
    return token === '' ? null : token;
  } catch {
    return null;
  }
}

export async function ensureControlToken(): Promise<string> {
  const existing = await readControlToken();
  if (existing != null) return existing;
  const token = randomBytes(32).toString('base64url');
  await mkdir(stateDir(), { recursive: true });
  // 0600: the whole point is that only this user's processes can read it.
  await writeFile(controlTokenPath(), `${token}\n`, { mode: 0o600 });
  return token;
}

// A recents list should not grow without bound, and nobody scrolls past the
// twenty repositories they last reviewed.
const KEEP = 20;

// Entries whose directory is gone. They cannot be reviewed and only clutter
// `hunk status`, which is where a temp directory from a test run lingers.
export function pruneMissingRepos(
  repos: readonly RegisteredRepo[]
): RegisteredRepo[] {
  return repos.filter((repo) => existsSync(repo.root));
}

export async function listRepos(): Promise<RegisteredRepo[]> {
  const file = await readFileJson(registryPath());
  const repos = Array.isArray(file.repos) ? file.repos : [];
  return repos.filter(
    (repo): repo is RegisteredRepo =>
      typeof repo?.id === 'string' && typeof repo?.root === 'string'
  );
}

export async function defaultRepoId(): Promise<string | null> {
  const file = await readFileJson(registryPath());
  if (typeof file.defaultId === 'string') return file.defaultId;
  const repos = await listRepos();
  return repos[0]?.id ?? null;
}

async function write(repos: RegisteredRepo[], defaultId: string): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(
    registryPath(),
    `${JSON.stringify({ repos: repos.slice(0, KEEP), defaultId }, null, 2)}\n`
  );
}

// Drops what is gone and writes the result, so `hunk status` reports what can
// actually be reviewed. Returns what is left.
export async function tidyRepos(): Promise<RegisteredRepo[]> {
  const repos = await listRepos();
  const kept = pruneMissingRepos(repos);
  if (kept.length !== repos.length) {
    await write(kept, kept[0]?.id ?? '');
  }
  return kept;
}

// Removes one repository from the list, or all of them. The repositories
// themselves are untouched; this is a list of what you have opened.
export async function forgetRepos(id?: string): Promise<number> {
  const repos = await listRepos();
  const kept = id == null ? [] : repos.filter((repo) => repo.id !== id);
  if (kept.length === repos.length) return 0;
  await write(kept, kept[0]?.id ?? '');
  return repos.length - kept.length;
}

// Adds a repository, or refreshes the one already there. The path is normalised
// through git first, so a subdirectory registers its work tree and a path that
// is not a repository is refused before it reaches the registry.
export async function registerRepo(path: string): Promise<RegisteredRepo> {
  const root = await findRepoRoot(path);
  if (root == null) {
    throw new Error(`${path} is not inside a git repository`);
  }

  const repo: RegisteredRepo = {
    id: repoIdFor(root),
    root,
    lastUsedAt: new Date().toISOString(),
  };
  const others = pruneMissingRepos(await listRepos()).filter(
    (entry) => entry.id !== repo.id
  );
  // Most recently opened first, and the newest becomes the default, which is
  // what `hunk` in a fresh repository should mean.
  await write([repo, ...others], repo.id);
  return repo;
}

export async function lookupRepo(id: string): Promise<RegisteredRepo | null> {
  return (await listRepos()).find((repo) => repo.id === id) ?? null;
}
