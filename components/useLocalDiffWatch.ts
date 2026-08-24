'use client';

import { useEffect, useRef, useState } from 'react';

interface UseLocalDiffWatchOptions {
  // Undefined disables watching entirely, which is how a GitHub review opts out.
  target: string | undefined;
  repoId: string | undefined;
  enabled: boolean;
  onChanged(): void;
}

// Whether this tab is the one being looked at. A hidden tab holding a stream
// open is a connection, and a connection is what keeps the server from stopping
// when nothing is using it -- so one tab left open in the background would pin a
// server alive for days. Dropping the stream while hidden is what makes idle
// mean idle.
function useTabVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return visible;
}

// Reloads a local review when the diff on disk changes.
//
// The server only holds the connection open for targets that can actually
// change and answers 204 otherwise, so a commit or a pinned range costs
// nothing here. EventSource reconnects on its own, and a 204 ends the stream
// cleanly rather than looking like a failure.
//
// Coming back to a hidden tab re-opens the stream, and that request is also
// what starts the server again if it stopped in the meantime: the service
// manager holds the port whether or not anything is running, so reconnecting is
// indistinguishable from never having disconnected.
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

  const visible = useTabVisible();
  // A tab returning to the foreground may have missed a change while it was
  // away, and the diff it is showing is then wrong until something says so.
  const wasHidden = useRef(false);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    if (!visible) {
      wasHidden.current = true;
      return;
    }

    if (wasHidden.current) {
      wasHidden.current = false;
      onChangedRef.current();
    }

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
  }, [enabled, repoId, target, visible]);
}
