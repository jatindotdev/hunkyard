// When to stop.
//
// Under socket activation the service manager keeps the port bound, so exiting
// is not the same as going away: the next connection starts us again. That makes
// running only while something is connected the honest lifecycle, and it is what
// keeps hunkyard from being a process that sits in your login items doing
// nothing between reviews.

export const DEFAULT_IDLE_MS = 5 * 60_000;

// Long enough that a browser's idle keep-alive sockets have closed and a page
// being reloaded has come back, short enough that a machine left alone stops
// running a server nobody asked for.
export interface IdleTimer {
  // Nothing is connected any more; start counting.
  idle(): void;
  // Something connected; stop counting.
  busy(): void;
  cancel(): void;
}

export function createIdleTimer(options: {
  afterMs?: number;
  onExpired(): void;
}): IdleTimer {
  const afterMs = options.afterMs ?? DEFAULT_IDLE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer != null) clearTimeout(timer);
    timer = undefined;
  };

  // Zero means never rather than immediately. A timeout of nothing would make
  // the server exit the moment the last connection closed, which is the most
  // aggressive setting rather than the disabled one, and disabling is what
  // anyone typing 0 is asking for.
  if (afterMs <= 0) return { idle: () => {}, busy: () => {}, cancel: () => {} };

  return {
    idle: () => {
      cancel();
      timer = setTimeout(options.onExpired, afterMs);
      // A pending exit must never be the reason the process stays alive, or a
      // server with nothing to do would be held open by the timer meant to
      // close it.
      timer.unref?.();
    },
    busy: cancel,
    cancel,
  };
}

// Seconds, and `0` disables it for anyone who would rather it stayed up.
// Anything unparseable falls back to the default rather than to never, since a
// typo should not silently leave a server running for good.
export function idleTimeoutFromEnv(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.HUNKYARD_IDLE_TIMEOUT;
  if (raw == null || raw.trim() === '') return DEFAULT_IDLE_MS;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isInteger(seconds) || seconds < 0) return DEFAULT_IDLE_MS;
  return seconds * 1000;
}
