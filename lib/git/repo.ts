import { findRepoRoot } from './exec';
import { repoIdFor } from '../repos/id';
import { defaultRepoId, lookupRepo } from '../repos/registry';
import type { RegisteredRepo } from '../repos/registry';

export const REPO_ROOT_ENV = 'HUNKYARD_REPO_ROOT';

export class NoRepositoryError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'No repository has been opened yet. Open one from the home page, or run `hunk` inside a git repository.'
    );
    this.name = 'NoRepositoryError';
  }
}

// A repository the request named that cannot be resolved. Distinct from having
// no repository at all, because it is the caller naming something wrong rather
// than the server being unconfigured, and the two deserve different codes.
export class UnknownRepositoryError extends NoRepositoryError {
  constructor(id: string) {
    super(`${id} is not a known repository id or a path inside a git repository.`);
    this.name = 'UnknownRepositoryError';
  }
}

// The repository to use when the registry is empty, which is the case under
// `bun dev`: there is no CLI invocation to have registered anything, so the
// repository being reviewed is the one the server was started in.
//
// Exposed so the repos endpoint reports the same thing the diff routes read.
// Without that the client is told there is nothing to review while every other
// route would happily serve it.
export async function resolveFallbackRepo(): Promise<RegisteredRepo | null> {
  const configured = process.env[REPO_ROOT_ENV] ?? process.cwd();
  if (configured.trim() === '') return null;
  const root = await findRepoRoot(configured);
  if (root == null) return null;
  return { id: repoIdFor(root), root, lastUsedAt: new Date().toISOString() };
}

// Which repository a request is about.
//
// `repo` is either an id from the registry, which is what `hunk` puts in the URL
// because it reads well, or a path to any repository on the machine. The
// registry is a list of what you have opened, for the default and for
// the opener's recents list; it is not an allowlist.
//
// What keeps that from being a way to read your disk from a web page is in
// server/guard.ts, not here: the Host check refuses a name we do not answer on,
// so DNS rebinding fails, and no route sends CORS headers, so a foreign page can
// start a request but never read the response. Writes additionally need an
// Origin we recognise. Path confinement in files.ts still applies within
// whichever repository is resolved.
export async function resolveRequestRepoRoot(
  request: Request
): Promise<string> {
  const requested = new URL(request.url).searchParams.get('repo');
  if (requested != null && requested !== '') {
    const repo = await lookupRepo(requested);
    if (repo != null) return normalise(repo.root);

    // The dev fallback has an id like any other repository, so a client that
    // read it from /api/repos can name it here.
    const fallback = await resolveFallbackRepo();
    if (fallback?.id === requested) return normalise(fallback.root);

    // Otherwise it is a path. git decides whether it is a repository, so a
    // directory that is not one fails here rather than half-working, and a
    // subdirectory resolves to its work tree.
    const root = await findRepoRoot(requested);
    if (root != null) return root;

    throw new UnknownRepositoryError(requested);
  }

  // Nothing named. An explicit environment variable comes first: it is
  // configuration, and losing to a recents list would mean `bun dev` in this
  // checkout opening whichever repository you last ran hunk in.
  const configured = process.env[REPO_ROOT_ENV];
  if (configured != null && configured.trim() !== '') {
    return normalise(configured);
  }

  // Then the most recently opened repository, which is what a hand-typed URL
  // hits and what the client redirects away from once it learns the id.
  const fallbackId = await defaultRepoId();
  if (fallbackId != null) {
    const repo = await lookupRepo(fallbackId);
    if (repo != null) return normalise(repo.root);
  }

  const fallback = await resolveFallbackRepo();
  if (fallback == null) throw new NoRepositoryError();
  return normalise(fallback.root);
}

// Normalise through git so a subdirectory still resolves to the work tree, and
// so a stale or deleted path fails clearly rather than half-working.
async function normalise(path: string): Promise<string> {
  const root = await findRepoRoot(path);
  if (root == null) throw new NoRepositoryError();
  return root;
}
