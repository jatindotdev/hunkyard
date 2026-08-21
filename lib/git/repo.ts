import { findRepoRoot } from './exec';

export const REPO_ROOT_ENV = 'HUNKYARD_REPO_ROOT';

export class NoRepositoryError extends Error {
  constructor() {
    super(
      'No local repository is configured. Local review is served by the `hunk` CLI; run `hunk` inside a git repository.'
    );
    this.name = 'NoRepositoryError';
  }
}

// The repository is fixed at process start by the CLI and never taken from a
// request. A request-supplied root would let any page that reaches the agent
// read any repository on the machine, so this is the boundary that makes the
// path checks in files.ts meaningful.
export async function resolveConfiguredRepoRoot(): Promise<string> {
  // The CLI always sets this. Falling back to the working directory is for
  // `bun dev`, where the repository you are reviewing is the one you are in.
  const configured = process.env[REPO_ROOT_ENV] ?? process.cwd();
  if (configured.trim() === '') {
    throw new NoRepositoryError();
  }
  // Normalise through git so a subdirectory still resolves to the work tree,
  // and so a stale or deleted path fails clearly rather than half-working.
  const root = await findRepoRoot(configured);
  if (root == null) throw new NoRepositoryError();
  return root;
}
