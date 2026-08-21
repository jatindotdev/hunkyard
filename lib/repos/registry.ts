import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
    `${JSON.stringify({ repos, defaultId }, null, 2)}\n`
  );
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
  const others = (await listRepos()).filter((entry) => entry.id !== repo.id);
  // Most recently opened first, and the newest becomes the default, which is
  // what `hunk` in a fresh repository should mean.
  await write([repo, ...others], repo.id);
  return repo;
}

export async function lookupRepo(id: string): Promise<RegisteredRepo | null> {
  return (await listRepos()).find((repo) => repo.id === id) ?? null;
}
