import { afterEach, describe, expect, test } from 'bun:test';

import {
  BARE_ORIGIN,
  canonicalRedirect,
  ensureBareUrlProbe,
  forgetBareUrlProbe,
} from '@/lib/proxy/canonical';

// Not the default: whatever a forwarder on this machine points at, it is not
// this, so the probe answers false deterministically rather than depending on
// what the developer happens to have installed.
const PORT = 45999;

function request(host: string, path = '/local?repo=x'): Request {
  return new Request(`http://${host}${path}`, { headers: { host } });
}

afterEach(() => {
  forgetBareUrlProbe();
});

describe('canonicalRedirect', () => {
  // A redirect to a port nothing is listening on would take the whole app
  // down, so an unanswered probe has to fail towards serving here.
  test('serves in place while the forwarder has not answered', async () => {
    expect(canonicalRedirect(request(`hunkyard.localhost:${PORT}`), PORT)).toBeNull();
    await ensureBareUrlProbe(PORT);
    expect(canonicalRedirect(request(`hunkyard.localhost:${PORT}`), PORT)).toBeNull();
  });

  test('leaves the bare host alone', () => {
    expect(canonicalRedirect(request('hunkyard.localhost'), PORT)).toBeNull();
  });

  // Someone on an IP address has bypassed the name deliberately.
  test('leaves an address alone', () => {
    expect(canonicalRedirect(request(`127.0.0.1:${PORT}`), PORT)).toBeNull();
  });
});

describe('probing', () => {
  test('answers false when the forwarder does not reach this server', async () => {
    expect(await ensureBareUrlProbe(PORT)).toBe(false);
  });

  test('the bare origin has no port in it', () => {
    expect(BARE_ORIGIN).toBe('http://hunkyard.localhost');
  });
});
