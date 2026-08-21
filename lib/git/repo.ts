import { findRepoRoot } from './exec';
import { defaultRepoId, lookupRepo } from '../repos/registry';

export const REPO_ROOT_ENV = 'HUNKYARD_REPO_ROOT';

export class NoRepositoryError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'No local repository is registered. Local review is served by the `hunk` CLI; run `hunk` inside a git repository.'
    );
    this.name = 'NoRepositoryError';
  }
}

// An id the registry does not know. Distinct from having no repository at all,
// because it is the caller naming something wrong rather than the server being
// unconfigured, and the two deserve different status codes.
export class UnknownRepositoryError extends NoRepositoryError {
  constructor(id: string) {
    super(`No repository is registered as ${id}. Run \`hunk\` in it again.`);
    this.name = 'UnknownRepositoryError';
  }
}

// Which repository a request is about.
//
// A request names a repository by id, never by path. The id is only meaningful
// against the registry, and only a local `hunk` invocation can add to it, so a
// page that reaches this port can address the repositories you have opened and
// nothing else. That boundary is what makes the path confinement in files.ts
// meaningful: without it, a request-supplied root would reach any directory on
// the machine.
export async function resolveRequestRepoRoot(
  request: Request
): Promise<string> {
  const id = new URL(request.url).searchParams.get('repo');
  if (id != null && id !== '') {
    const repo = await lookupRepo(id);
    if (repo == null) throw new UnknownRepositoryError(id);
    return normalise(repo.root);
  }

  // No id: the most recently opened repository. This is what a hand-typed URL
  // and `bun dev` both hit, and what the client redirects away from once it
  // learns the id.
  const fallbackId = await defaultRepoId();
  if (fallbackId != null) {
    const repo = await lookupRepo(fallbackId);
    if (repo != null) return normalise(repo.root);
  }

  // Nothing registered at all. In dev there is no CLI to have registered
  // anything, so the repository you are reviewing is the one you are in.
  const configured = process.env[REPO_ROOT_ENV] ?? process.cwd();
  if (configured.trim() === '') throw new NoRepositoryError();
  return normalise(configured);
}

// Normalise through git so a subdirectory still resolves to the work tree, and
// so a stale or deleted path fails clearly rather than half-working.
async function normalise(path: string): Promise<string> {
  const root = await findRepoRoot(path);
  if (root == null) throw new NoRepositoryError();
  return root;
}
