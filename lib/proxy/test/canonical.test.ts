import { afterEach, describe, expect, test } from 'bun:test';

import {
  BARE_ORIGIN,
  ensureBareUrlProbe,
  forgetBareUrlProbe,
} from '@/lib/proxy/canonical';

afterEach(() => {
  forgetBareUrlProbe();
});

describe('BARE_ORIGIN', () => {
  // The whole point of registering port 80: one origin, so browser storage is
  // one store rather than one per URL you happened to open.
  test('has no port in it', () => {
    expect(BARE_ORIGIN).toBe('http://hunkyard.localhost');
  });
});

describe('ensureBareUrlProbe', () => {
  // Whether it answers true depends on whether the machine running this has
  // hunkyard registered, so the assertion is about the shape rather than the
  // verdict. What matters here is that asking is cheap and repeatable.
  test('answers, and answers the same way twice within its window', async () => {
    const first = await ensureBareUrlProbe();
    expect(typeof first).toBe('boolean');
    expect(await ensureBareUrlProbe()).toBe(first);
  });

  // The answer goes stale in both directions -- registered since we started, or
  // removed since -- so it must be forgettable rather than cached for the life
  // of the process.
  test('can be forgotten and asked again', async () => {
    await ensureBareUrlProbe();
    forgetBareUrlProbe();
    expect(typeof (await ensureBareUrlProbe())).toBe('boolean');
  });
});
