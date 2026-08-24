// One origin for one app.
//
// With the bare host in play there are two: `http://hunkyard.localhost` and
// `http://hunkyard.localhost:4865`. Browser storage is per-origin, so viewed
// state and display preferences would silently depend on which URL you happened
// to open -- the exact failure the fixed port was chosen to avoid. So the bare
// host is canonical whenever port 80 actually reaches us, and the ported one
// redirects to it.

import { BARE_PORT } from './service';

export const BARE_HOST = 'hunkyard.localhost';
export const BARE_ORIGIN = `http://${BARE_HOST}`;

// Whether the forwarder answered, or null before anything has asked.
let reachable: boolean | null = null;
let checkedAt = 0;
let probedPort: number | null = null;
let probing: Promise<boolean> | null = null;

// The answer goes stale in both directions: a forwarder installed after the
// server started should start being used, and one that has been removed must
// stop being redirected to. One loopback request every half minute is nothing
// next to sending every page load to a dead port.
const ANSWER_TTL_MS = 30_000;

// Gated on the forwarder working rather than on the plist existing: a redirect
// to a port nothing is listening on takes the whole app down, which is worse
// than a split store. It has to fail towards serving on the port we are on.
export async function probeBareUrl(
  port: number,
  timeoutMs = 1000
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${BARE_PORT}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { app?: string; port?: number };
    // Something else on port 80 is not our forwarder, and redirecting to it
    // would hand the app to whatever that is. The port has to match too: the
    // forwarder points at one server, and a second one on another port is not
    // the one the bare URL reaches.
    return body.app === 'hunkyard' && body.port === port;
  } catch {
    return false;
  }
}

export function ensureBareUrlProbe(port: number): Promise<boolean> {
  const fresh =
    reachable != null &&
    probedPort === port &&
    Date.now() - checkedAt < ANSWER_TTL_MS;
  if (fresh) return Promise.resolve(reachable as boolean);
  probedPort = port;
  probing ??= probeBareUrl(port).then((answer) => {
    reachable = answer;
    checkedAt = Date.now();
    probing = null;
    return answer;
  });
  return probing;
}

export function forgetBareUrlProbe(): void {
  reachable = null;
  checkedAt = 0;
  probedPort = null;
}

export function bareUrlReachable(): boolean | null {
  return reachable;
}

// The URL to print, open and redirect to.
export async function canonicalOrigin(port: number): Promise<string> {
  return (await ensureBareUrlProbe(port))
    ? BARE_ORIGIN
    : `${BARE_ORIGIN}:${port}`;
}

// A 302 to the bare host for a document request that arrived on the port, or
// null to serve it here.
//
// Done server-side rather than in the client: a probe from `:4865` to the bare
// host is same-site cross-origin, so its response is opaque and the redirect
// would have to be taken on faith.
export function canonicalRedirect(
  request: Request,
  port: number
): Response | null {
  const host = request.headers.get('host');
  // Only the bare host with a port. An IP address is someone deliberately
  // bypassing the name, and moving them off it would be a surprise.
  if (host == null || !host.startsWith(`${BARE_HOST}:`)) return null;

  // Re-probe on the way past, but never wait for it: an answer that has gone
  // stale is corrected for the next load, and this one is served here.
  void ensureBareUrlProbe(port);
  if (reachable !== true) return null;

  const url = new URL(request.url);
  return Response.redirect(`${BARE_ORIGIN}${url.pathname}${url.search}`, 302);
}
