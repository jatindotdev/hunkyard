import { describe, expect, test } from 'bun:test';

import {
  createIdleTimer,
  DEFAULT_IDLE_MS,
  idleTimeoutFromEnv,
  MIN_IDLE_MS,
} from '@/lib/service/idle';

describe('idleTimeoutFromEnv', () => {
  test('is a minute by default', () => {
    expect(idleTimeoutFromEnv({})).toBe(DEFAULT_IDLE_MS);
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '' })).toBe(
      DEFAULT_IDLE_MS
    );
  });

  test('reads seconds', () => {
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '90' })).toBe(90_000);
  });

  // A typo should not silently leave a server running for good.
  test('falls back to the default rather than to never', () => {
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: 'soon' })).toBe(
      DEFAULT_IDLE_MS
    );
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '-1' })).toBe(
      DEFAULT_IDLE_MS
    );
  });

  test('zero is a real setting', () => {
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '0' })).toBe(0);
  });

  // Below the floor a reader sitting on an unchanging diff could be cut off
  // between two heartbeats of the stream that represents them.
  test('will not go below the floor', () => {
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '1' })).toBe(MIN_IDLE_MS);
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '45' })).toBe(45_000);
  });
});

describe('createIdleTimer', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Zero is the disabled setting, not the most aggressive one: a timeout of
  // nothing would exit the moment anything went quiet.
  test('zero never expires', async () => {
    let expired = false;
    const timer = createIdleTimer({
      afterMs: 0,
      onExpired: () => {
        expired = true;
      },
    });
    timer.touch();
    await wait(30);
    expect(expired).toBe(false);
  });

  test('expires once nothing has happened', async () => {
    let expired = false;
    const timer = createIdleTimer({
      afterMs: 10,
      onExpired: () => {
        expired = true;
      },
    });
    timer.touch();
    await wait(60);
    expect(expired).toBe(true);
  });

  // What a heartbeat on a held-open stream does: quiet traffic is still
  // traffic, and keeps the clock from running out.
  test('activity keeps pushing the exit back', async () => {
    let expired = false;
    const timer = createIdleTimer({
      afterMs: 40,
      onExpired: () => {
        expired = true;
      },
    });
    for (let beat = 0; beat < 5; beat += 1) {
      timer.touch();
      await wait(15);
    }
    expect(expired).toBe(false);
    await wait(80);
    expect(expired).toBe(true);
  });
});
