'use client';

import { useCallback, useState } from 'react';

const KEY_PREFIX = 'hunkyard:pref:';

// A stored value is only accepted if it is still one this build understands.
// Stored prefs outlive the code that wrote them, so a value dropped from a
// union in a later version must not reach the viewer as a valid option.
export type PrefCodec<T> = (raw: unknown) => T | undefined;

export function oneOf<const T extends readonly (string | boolean)[]>(
  allowed: T
): PrefCodec<T[number]> {
  return (raw) =>
    allowed.includes(raw as T[number]) ? (raw as T[number]) : undefined;
}

export const boolPref: PrefCodec<boolean> = (raw) =>
  typeof raw === 'boolean' ? raw : undefined;

function read<T>(name: string, decode: PrefCodec<T>): T | undefined {
  try {
    const stored = window.localStorage.getItem(KEY_PREFIX + name);
    return stored == null ? undefined : decode(JSON.parse(stored));
  } catch {
    // Unparseable, or storage denied entirely (private windows, a blocked
    // origin). Either way the default is the answer.
    return undefined;
  }
}

// A useState whose value survives a reload, keyed by name under one localStorage
// prefix. Sound because the app is served from a fixed origin
// (hunkyard.localhost:4865): an ephemeral port would hand out a new origin, and
// an empty store, on every restart.
export function usePersistedState<T>(
  name: string,
  fallback: T,
  decode: PrefCodec<T>
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => read(name, decode) ?? fallback);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(KEY_PREFIX + name, JSON.stringify(next));
      } catch {
        // Storage being unavailable must not break the toggle it backs, so the
        // pref stays in memory for this session.
      }
    },
    [name]
  );
  return [value, set];
}
