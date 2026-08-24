// The daemon binds loopback, which stops another machine reaching it but not
// another page in your browser. Two different attacks follow from that, and they
// need two different checks.
//
// A page on the public internet can point a hostname it controls at 127.0.0.1
// and have your browser treat its own origin as ours (DNS rebinding). What gives
// it away is the Host header, which still carries the attacker's name, so only
// the names we actually answer on are accepted.
//
// A page can also just submit a form or fire a request at our real address. It
// cannot read the response, but a write would already have happened, so anything
// that changes state has to carry an Origin we recognise.
//
// Neither of those stops a foreign page *causing* a read. Origin is absent on a
// same-origin GET, so its absence cannot be refused, and missing CORS headers
// stop that page reading the reply rather than stop the work happening. For an
// endpoint that enumerates directories, causing the work is already too much.
// Sec-Fetch-Site is what closes it: the browser sets it, page script cannot
// forge it, and it is absent for curl and for the CLI -- so refusing a value
// that is present and not ours costs neither of them anything.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const HUNKYARD_HOST = 'hunkyard.localhost';

function isOurHost(host: string | null): boolean {
  if (host == null || host === '') return false;
  // A Host header is `name` or `name:port`; the port is ours by construction,
  // since the request arrived on our socket.
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return name === HUNKYARD_HOST || LOOPBACK_HOSTS.has(name);
}

export function isOurOrigin(origin: string): boolean {
  try {
    return isOurHost(new URL(origin).host);
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// `none` is a URL typed into the address bar; `same-origin` is our own client.
// `same-site` and `cross-site` are both another page reaching for us.
const OUR_FETCH_SITES = new Set(['same-origin', 'none']);

// Whether a request may write to state the CLI and the client share.
//
// rejectUntrustedRequest only refuses an Origin that is present and foreign, so
// leaning on it alone would leave `curl -X POST` -- which sends no Origin at
// all -- able to write. A write needs an Origin that is present and ours.
//
// This is now the whole boundary: it used to be a token in the state directory
// that only local processes could read. Widening the Host allowlist therefore
// widens every write, not just reads.
export function isOurWrite(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin != null && isOurOrigin(origin);
}

// Whether to answer this request at all. Returns a Response to send instead when
// the answer is no.
export function rejectUntrustedRequest(request: Request): Response | null {
  if (!isOurHost(request.headers.get('host'))) {
    return new Response('Unrecognised Host header.', { status: 403 });
  }

  const site = request.headers.get('sec-fetch-site');
  if (site != null && !OUR_FETCH_SITES.has(site)) {
    return new Response('Cross-site request refused.', { status: 403 });
  }

  // Browsers omit Origin on same-origin GETs, so its absence cannot be treated
  // as a failure. For a write it is always present cross-origin, which is the
  // case this is here to stop.
  const origin = request.headers.get('origin');
  if (
    !SAFE_METHODS.has(request.method) &&
    origin != null &&
    !isOurOrigin(origin)
  ) {
    return new Response('Cross-origin write refused.', { status: 403 });
  }

  return null;
}
