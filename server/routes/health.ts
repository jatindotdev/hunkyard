import { resolveConfiguredRepoRoot } from '../../lib/git/repo';

// Lets a second `hunk` invocation tell whether the port is occupied by us and,
// if so, which repository we are serving -- so it can reuse the server instead
// of failing, but still refuse to silently show the wrong repository.
//
// Resolution goes through the same path the diff routes use, so this cannot
// report a different repository from the one they would read.
export async function handleHealth(): Promise<Response> {
  const repoRoot = await resolveConfiguredRepoRoot().catch(() => null);

  return Response.json(
    { app: 'hunkyard', repoRoot },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
