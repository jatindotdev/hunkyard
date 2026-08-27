'use client';

import { useEffect, useRef, useState } from 'react';

import type { DirectoryListing } from '@/lib/fs/browse';

export interface ListingState {
  listing: DirectoryListing | null;
  loading: boolean;
  error: string | null;
}

function browseUrl(
  path: string | undefined,
  filter: string,
  hidden: boolean
): string {
  const params = new URLSearchParams();
  if (path != null && path !== '') params.set('path', path);
  if (filter.trim() !== '') params.set('filter', filter.trim());
  if (hidden) params.set('hidden', '1');
  const query = params.toString();
  return query === '' ? '/api/browse' : `/api/browse?${query}`;
}

// Lists one directory, and keeps the previous listing on screen while the next
// one loads: arrow-keying down a column of folders would otherwise flash empty
// between every step.
export function useDirectoryListing(
  path: string | undefined,
  options: { filter?: string; hidden?: boolean } = {}
): ListingState {
  const filter = options.filter ?? '';
  const hidden = options.hidden ?? false;
  const previous = useRef<DirectoryListing | null>(null);
  const [state, setState] = useState<ListingState>({
    listing: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ listing: previous.current, loading: true, error: null });

    void (async () => {
      try {
        const response = await fetch(browseUrl(path, filter, hidden), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          setState({
            listing: null,
            loading: false,
            error: (await response.text()).trim(),
          });
          return;
        }
        const listing = (await response.json()) as DirectoryListing;
        previous.current = listing;
        setState({ listing, loading: false, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          listing: null,
          loading: false,
          error:
            error instanceof Error ? error.message : 'Failed to list the folder.',
        });
      }
    })();

    return () => controller.abort();
  }, [path, filter, hidden]);

  return state;
}
