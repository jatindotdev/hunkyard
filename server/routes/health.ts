import { listRepos } from '../../lib/repos/registry';
import { resolveServerGitHubToken } from '../../lib/serverGitHubToken';

// When this process began serving. A long-lived server keeps running whatever
// binary it started with, so a rebuilt or upgraded hunk on disk is not the hunk
// answering: this is what lets `hunk service status` notice.
const STARTED_AT = new Date().toISOString();

// Lets a `hunk` invocation tell whether the port is occupied by us, so it can
// reuse a running daemon instead of starting a second one. It no longer reports
// a single repository: the daemon serves every registered repository at once, so
// there is nothing for a second invocation to conflict with.
export async function handleHealth(
  options: { port?: number } = {}
): Promise<Response> {
  const repos = await listRepos();

  return Response.json(
    {
      app: 'hunkyard',
      // Which port this answered on. The forwarder points at one port, so
      // anything asking whether the bare URL reaches *it* has to compare.
      port: options.port ?? null,
      startedAt: STARTED_AT,
      repos: repos.length,
      // A later invocation cannot hand a token to an already-running server, so
      // it needs to be able to see whether this one has one.
      github: resolveServerGitHubToken() != null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
