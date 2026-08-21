'use client';

import { useEffect, useRef } from 'react';

interface UseLocalDiffWatchOptions {
  // Undefined disables watching entirely, which is how a GitHub review opts out.
  target: string | undefined;
  repoId: string | undefined;
  enabled: boolean;
  onChanged(): void;
}

// Reloads a local review when the diff on disk changes.
//
// The server only holds the connection open for targets that can actually
// change and answers 204 otherwise, so a commit or a pinned range costs
// nothing here. EventSource reconnects on its own, and a 204 ends the stream
// cleanly rather than looking like a failure.
export function useLocalDiffWatch({
  target,
  repoId,
  enabled,
  onChanged,
}: UseLocalDiffWatchOptions): void {
  // Kept in a ref so a new callback identity does not tear down the connection
  // and re-establish the watcher on every render.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    const params = new URLSearchParams();
    if (target != null) params.set('target', target);
    if (repoId != null) params.set('repo', repoId);
    const source = new EventSource(`/api/local-events?${params}`);

    const handleChanged = () => onChangedRef.current();
    source.addEventListener('changed', handleChanged);

    return () => {
      source.removeEventListener('changed', handleChanged);
      source.close();
    };
  }, [enabled, repoId, target]);
}
