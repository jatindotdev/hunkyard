import { describe, expect, test } from 'bun:test';

import {
  createIdleTimer,
  DEFAULT_IDLE_MS,
  idleTimeoutFromEnv,
} from '@/lib/service/idle';

describe('idleTimeoutFromEnv', () => {
  test('is a minute by default', () => {
    expect(idleTimeoutFromEnv({})).toBe(DEFAULT_IDLE_MS);
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '' })).toBe(
      DEFAULT_IDLE_MS
    );
  });

  test('reads seconds', () => {
    expect(idleTimeoutFromEnv({ HUNKYARD_IDLE_TIMEOUT: '30' })).toBe(30_000);
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
});

describe('createIdleTimer', () => {
  // Zero is the disabled setting, not the most aggressive one: a timeout of
  // nothing would exit the moment the last connection closed.
  test('zero never expires', async () => {
    let expired = false;
    const timer = createIdleTimer({ afterMs: 0, onExpired: () => {
      expired = true;
    } });
    timer.idle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(expired).toBe(false);
  });

  test('expires once nothing is connected', async () => {
    let expired = false;
    const timer = createIdleTimer({ afterMs: 10, onExpired: () => {
      expired = true;
    } });
    timer.idle();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(expired).toBe(true);
  });

  test('a connection cancels a pending exit', async () => {
    let expired = false;
    const timer = createIdleTimer({ afterMs: 20, onExpired: () => {
      expired = true;
    } });
    timer.idle();
    timer.busy();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(expired).toBe(false);
  });
});
