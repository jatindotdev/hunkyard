import { describe, expect, test } from 'bun:test';

import { isOurWrite, rejectUntrustedRequest } from '../guard';

function request(
  headers: Record<string, string>,
  method = 'GET'
): Request {
  return new Request('http://hunkyard.localhost:4865/api/browse', {
    method,
    headers: { host: 'hunkyard.localhost:4865', ...headers },
  });
}

describe('rejectUntrustedRequest', () => {
  test('refuses a Host we do not answer on', () => {
    expect(rejectUntrustedRequest(request({ host: 'evil.example.com' }))?.status).toBe(403);
  });

  test('accepts the bare host and the port alike', () => {
    expect(rejectUntrustedRequest(request({ host: 'hunkyard.localhost' }))).toBeNull();
    expect(
      rejectUntrustedRequest(request({ host: 'hunkyard.localhost:4865' }))
    ).toBeNull();
    expect(rejectUntrustedRequest(request({ host: '127.0.0.1:4865' }))).toBeNull();
  });
});

// Missing CORS headers stop a foreign page reading a reply, not causing the
// work behind it. For an endpoint that enumerates directories, that is not
// enough, and Sec-Fetch-Site is the only header a page cannot forge.
describe('Sec-Fetch-Site', () => {
  test('refuses a cross-site read', () => {
    expect(
      rejectUntrustedRequest(request({ 'sec-fetch-site': 'cross-site' }))?.status
    ).toBe(403);
    expect(
      rejectUntrustedRequest(request({ 'sec-fetch-site': 'same-site' }))?.status
    ).toBe(403);
  });

  test('accepts our own client', () => {
    expect(
      rejectUntrustedRequest(request({ 'sec-fetch-site': 'same-origin' }))
    ).toBeNull();
  });

  test('accepts a URL typed into the address bar', () => {
    expect(rejectUntrustedRequest(request({ 'sec-fetch-site': 'none' }))).toBeNull();
  });

  // curl and the CLI send no such header, and both have to keep working.
  test('accepts a request without the header at all', () => {
    expect(rejectUntrustedRequest(request({}))).toBeNull();
  });
});

describe('isOurWrite', () => {
  test('accepts an Origin of ours', () => {
    expect(
      isOurWrite(request({ origin: 'http://hunkyard.localhost' }, 'POST'))
    ).toBe(true);
    expect(
      isOurWrite(request({ origin: 'http://127.0.0.1:4865' }, 'POST'))
    ).toBe(true);
  });

  test('refuses a foreign Origin', () => {
    expect(
      isOurWrite(request({ origin: 'https://evil.example.com' }, 'POST'))
    ).toBe(false);
  });

  // rejectUntrustedRequest only refuses an Origin that is present and foreign,
  // so a write gated on that alone would still accept `curl -X POST`.
  test('refuses a request with no Origin at all', () => {
    expect(isOurWrite(request({}, 'POST'))).toBe(false);
  });
});
