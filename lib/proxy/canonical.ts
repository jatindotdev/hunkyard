// Whether http://hunkyard.localhost is registered, and therefore whether it is
// a URL we can hand over.
//
// There is one origin for this app, because browser storage is per-origin and
// two would mean your viewed state depended on which URL you opened. Rather
// than reconcile two, the ported one is not offered at all: this says whether
// the real one works, and `hunk install` is the answer when it does not.
//
// Asking is also starting. The service manager runs hunkyard on the first
// connection, so a probe that succeeds has just started the server the caller
// is about to use.

import { BARE_PORT } from './service';

export const BARE_HOST = 'hunkyard.localhost';
export const BARE_ORIGIN = `http://${BARE_HOST}`;

// Whether the forwarder answered, or null before anything has asked.
let reachable: boolean | null = null;
let checkedAt = 0;
let probing: Promise<boolean> | null = null;

// The answer goes stale in both directions: a forwarder installed after the
// server started should start being used, and one that has been removed must
// stop being redirected to. One loopback request every half minute is nothing
// next to sending every page load to a dead port.
const ANSWER_TTL_MS = 30_000;

// Gated on the forwarder working rather than on the plist existing: a redirect
// to a port nothing is listening on takes the whole app down, which is worse
// than a split store. It has to fail towards serving on the port we are on.
export async function probeBareUrl(timeoutMs = 1000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${BARE_PORT}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { app?: string };
    // Something else on port 80 is not us, and treating it as ours would hand
    // the app to whatever that is. There is no port to compare any more: the
    // service manager holds port 80 and what answers behind it is this server,
    // on a port nothing else ever names.
    return body.app === 'hunkyard';
  } catch {
    return false;
  }
}

export function ensureBareUrlProbe(): Promise<boolean> {
  const fresh = reachable != null && Date.now() - checkedAt < ANSWER_TTL_MS;
  if (fresh) return Promise.resolve(reachable as boolean);
  probing ??= probeBareUrl().then((answer) => {
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
}

export function bareUrlReachable(): boolean | null {
  return reachable;
}

// The URL to print, open and redirect to.
export async function canonicalOrigin(port: number): Promise<string> {
  return (await ensureBareUrlProbe()) ? BARE_ORIGIN : `${BARE_ORIGIN}:${port}`;
}
