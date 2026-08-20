import { REPO_ROOT_ENV } from '@/lib/git/repo';
import { findRepoRoot } from '@/lib/git/exec';

// Lets a second `hunk` invocation tell whether the port is occupied by us and,
// if so, which repository we are serving -- so it can reuse the server instead
// of failing, but still refuse to silently show the wrong repository.
export async function GET(): Promise<Response> {
  const configured = process.env[REPO_ROOT_ENV];
  const repoRoot =
    configured == null || configured.trim() === ''
      ? null
      : await findRepoRoot(configured);

  return Response.json(
    { app: 'hunkyard', repoRoot },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
