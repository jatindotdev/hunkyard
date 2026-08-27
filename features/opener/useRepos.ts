'use client';

import { useCallback, useEffect, useState } from 'react';

export interface KnownRepo {
  id: string;
  root: string;
  lastUsedAt?: string;
}

interface ReposBody {
  repos?: KnownRepo[];
  defaultId?: string | null;
  home?: string;
}

interface ReposState {
  repos: KnownRepo[];
  defaultId: string | null;
  // The home directory, where browsing starts and which every recent path is
  // shortened against.
  home: string | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: ReposState = {
  repos: [],
  defaultId: null,
  home: null,
  loading: true,
  error: null,
};

// One list, shared. The header and the opener both want it, and two components
// mounting at once would otherwise be two requests for the same answer.
let cache: ReposState | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(state: ReposState) => void>();

function publish(state: ReposState): void {
  cache = state;
  for (const listener of listeners) listener(state);
}

async function load(): Promise<void> {
  try {
    const response = await fetch('/api/repos', { cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());
    const body = (await response.json()) as ReposBody;
    publish({
      repos: body.repos ?? [],
      defaultId: body.defaultId ?? null,
      home: body.home ?? null,
      loading: false,
      error: null,
    });
  } catch (error) {
    publish({
      repos: [],
      defaultId: null,
      home: null,
      loading: false,
      error:
        error instanceof Error ? error.message : 'Failed to list repositories.',
    });
  } finally {
    inFlight = null;
  }
}

function ensureLoaded(): void {
  if (cache != null || inFlight != null) return;
  inFlight = load();
}

export interface UseRepos extends ReposState {
  // After registering or forgetting one, so every consumer of the list agrees.
  refresh(): Promise<void>;
  open(path: string): Promise<KnownRepo>;
  forget(id: string): Promise<void>;
}

export function useRepos(): UseRepos {
  const [state, setState] = useState<ReposState>(() => cache ?? EMPTY);

  useEffect(() => {
    listeners.add(setState);
    ensureLoaded();
    if (cache != null) setState(cache);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const refresh = useCallback(async () => {
    inFlight = load();
    await inFlight;
  }, []);

  // One round trip both opens a repository and remembers it: the reply carries
  // the id the review URL needs.
  const open = useCallback(
    async (path: string): Promise<KnownRepo> => {
      const response = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!response.ok) throw new Error((await response.text()).trim());
      const repo = (await response.json()) as KnownRepo;
      await refresh();
      return repo;
    },
    [refresh]
  );

  const forget = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/repos/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error((await response.text()).trim());
      await refresh();
    },
    [refresh]
  );

  return { ...state, refresh, open, forget };
}
