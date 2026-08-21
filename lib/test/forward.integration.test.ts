import { afterEach, describe, expect, test } from 'bun:test';

import { startForwarder } from '../proxy/forward';

let stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
});

describe('the port 80 forwarder', () => {
  test('carries a request and its response through', async () => {
    const origin = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) =>
        new Response(`saw ${new URL(request.url).pathname}`, {
          headers: { 'x-host': request.headers.get('host') ?? '' },
        }),
    });
    stops.push(() => void origin.stop(true));

    const forwarder = startForwarder({ from: 0, to: origin.port as number });
    stops.push(forwarder.stop);

    const response = await fetch(`http://127.0.0.1:${forwarder.port}/hello`);
    expect(await response.text()).toBe('saw /hello');
    // The Host the client sent arrives untouched, which is what lets the
    // server's own Host check still mean something behind this.
    expect(response.headers.get('x-host')).toBe(`127.0.0.1:${forwarder.port}`);
  });

  // A body larger than one chunk exercises the buffering: dropping data while
  // the far side connects or applies backpressure would truncate a request.
  test('carries a body larger than a single chunk', async () => {
    const origin = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => new Response(String((await request.text()).length)),
    });
    stops.push(() => void origin.stop(true));

    const forwarder = startForwarder({ from: 0, to: origin.port as number });
    stops.push(forwarder.stop);

    const body = 'x'.repeat(2_000_000);
    const response = await fetch(`http://127.0.0.1:${forwarder.port}/`, {
      method: 'POST',
      body,
    });
    expect(await response.text()).toBe(String(body.length));
  });

  // Nothing on the target port must fail the connection rather than hang, which
  // is what would happen with no forwarder at all.
  test('fails the connection when nothing is serving the target', async () => {
    const forwarder = startForwarder({ from: 0, to: 9 });
    stops.push(forwarder.stop);

    await expect(
      fetch(`http://127.0.0.1:${forwarder.port}/`, {
        signal: AbortSignal.timeout(5000),
      })
    ).rejects.toThrow();
  });
});
