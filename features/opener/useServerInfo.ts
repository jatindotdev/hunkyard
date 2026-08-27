'use client';

import { useEffect, useState } from 'react';

export interface ServerInfo {
  // Whether the server already holds a GitHub token, from the environment or
  // from `gh auth token`. When it does, the browser has nothing to supply.
  github: boolean;
  loading: boolean;
}

const UNKNOWN: ServerInfo = { github: false, loading: true };

// One answer, shared. It cannot change while the server is up: the token is
// resolved in that process, so re-asking per component would be per-component
// noise for a constant.
let cache: ServerInfo | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(info: ServerInfo) => void>();

async function load(): Promise<void> {
  let next: ServerInfo = { github: false, loading: false };
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (response.ok) {
      const body = (await response.json()) as { github?: boolean };
      next = { github: body.github === true, loading: false };
    }
  } catch {
    // Unreachable is the same as "cannot tell", and the safe reading of that is
    // to offer the token form rather than hide it.
  }
  cache = next;
  for (const listener of listeners) listener(next);
  inFlight = null;
}

export function useServerInfo(): ServerInfo {
  const [info, setInfo] = useState<ServerInfo>(() => cache ?? UNKNOWN);

  useEffect(() => {
    listeners.add(setInfo);
    if (cache != null) setInfo(cache);
    else inFlight ??= load();
    return () => {
      listeners.delete(setInfo);
    };
  }, []);

  return info;
}
