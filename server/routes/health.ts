import { listRepos } from '../../lib/repos/registry';
import { resolveServerGitHubToken } from '../../lib/serverGitHubToken';

// Lets a `hunk` invocation tell whether the port is occupied by us, so it can
// reuse a running daemon instead of starting a second one. It no longer reports
// a single repository: the daemon serves every registered repository at once, so
// there is nothing for a second invocation to conflict with.
export async function handleHealth(): Promise<Response> {
  const repos = await listRepos();

  return Response.json(
    {
      app: 'hunkyard',
      repos: repos.length,
      // A later invocation cannot hand a token to an already-running server, so
      // it needs to be able to see whether this one has one.
      github: resolveServerGitHubToken() != null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
