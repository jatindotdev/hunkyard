'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Thread, ThreadAnchor } from '@/lib/review/types';

export interface ReviewCapabilities {
  batches: boolean;
  supportsResolve: boolean;
  author: string | null;
  // The commit new comments are anchored to.
  headCommitId: string | null;
}

// A comment being typed. Several can exist at once, which is the whole point:
// the layer this replaces enforced exactly one draft globally, so writing a few
// comments before submitting was impossible.
export interface DraftComment {
  id: string;
  anchor: ThreadAnchor;
  replyToThreadId?: string;
  body: string;
}

interface UseReviewThreadsOptions {
  // Identifies the review to the API: a local revspec or a GitHub path.
  query: string;
  enabled: boolean;
}

export interface ReviewThreadsState {
  threads: Thread[];
  drafts: DraftComment[];
  capabilities: ReviewCapabilities | null;
  error: string | null;
  busy: boolean;
  startDraft(anchor: ThreadAnchor, replyToThreadId?: string): string;
  updateDraft(draftId: string, body: string): void;
  discardDraft(draftId: string): void;
  saveDraft(draftId: string): Promise<void>;
  removeComment(threadId: string, commentId: string): Promise<void>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  submit(event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body?: string): Promise<void>;
  reload(): Promise<void>;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // fall through
  }
  return `${response.status} ${response.statusText}`;
}

async function callJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers:
      init?.body == null
        ? undefined
        : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

let nextDraftId = 0;

export function useReviewThreads({
  query,
  enabled,
}: UseReviewThreadsOptions): ReviewThreadsState {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  const [capabilities, setCapabilities] = useState<ReviewCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Drafts must not be dropped when the diff reloads, and a local review
  // reloads on every file save. So they live outside the fetch effect and are
  // never cleared by it.
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const [loadedThreads, loadedCapabilities] = await Promise.all([
        callJson<Thread[]>(`/api/threads?${query}`),
        callJson<ReviewCapabilities>(`/api/review/capabilities?${query}`),
      ]);
      setThreads(loadedThreads);
      setCapabilities(loadedCapabilities);
      setError(null);
    } catch (loadError) {
      // A review that cannot load must not take the diff down with it.
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [enabled, query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startDraft = useCallback(
    (anchor: ThreadAnchor, replyToThreadId?: string): string => {
      const id = `draft-${nextDraftId++}`;
      setDrafts((prev) => [...prev, { id, anchor, replyToThreadId, body: '' }]);
      return id;
    },
    []
  );

  const updateDraft = useCallback((draftId: string, body: string) => {
    setDrafts((prev) =>
      prev.map((draft) => (draft.id === draftId ? { ...draft, body } : draft))
    );
  }, []);

  const discardDraft = useCallback((draftId: string) => {
    setDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
  }, []);

  const saveDraft = useCallback(
    async (draftId: string) => {
      const draft = draftsRef.current.find((candidate) => candidate.id === draftId);
      if (draft == null || draft.body.trim() === '') return;
      setBusy(true);
      try {
        await callJson<Thread>(`/api/threads?${query}`, {
          method: 'POST',
          body: JSON.stringify({
            anchor: draft.anchor,
            body: draft.body,
            replyToThreadId: draft.replyToThreadId,
          }),
        });
        // Only drop the draft once the write succeeded, so a failure leaves the
        // text on screen rather than losing it.
        discardDraft(draftId);
        await reload();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setBusy(false);
      }
    },
    [discardDraft, query, reload]
  );

  const removeComment = useCallback(
    async (threadId: string, commentId: string) => {
      setBusy(true);
      try {
        await callJson(
          `/api/threads/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}?${query}`,
          { method: 'DELETE' }
        );
        await reload();
      } catch (removeError) {
        setError(removeError instanceof Error ? removeError.message : String(removeError));
      } finally {
        setBusy(false);
      }
    },
    [query, reload]
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      setBusy(true);
      try {
        await callJson(`/api/threads/${encodeURIComponent(threadId)}?${query}`, {
          method: 'PATCH',
          body: JSON.stringify({ resolved }),
        });
        await reload();
      } catch (resolveError) {
        setError(resolveError instanceof Error ? resolveError.message : String(resolveError));
      } finally {
        setBusy(false);
      }
    },
    [query, reload]
  );

  const submit = useCallback(
    async (
      event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
      body?: string
    ) => {
      setBusy(true);
      try {
        await callJson(`/api/review/submit?${query}`, {
          method: 'POST',
          body: JSON.stringify({ event, body }),
        });
        await reload();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : String(submitError));
      } finally {
        setBusy(false);
      }
    },
    [query, reload]
  );

  return useMemo(
    () => ({
      threads,
      drafts,
      capabilities,
      error,
      busy,
      startDraft,
      updateDraft,
      discardDraft,
      saveDraft,
      removeComment,
      setResolved,
      submit,
      reload,
    }),
    [
      busy,
      capabilities,
      discardDraft,
      drafts,
      error,
      reload,
      removeComment,
      saveDraft,
      setResolved,
      startDraft,
      submit,
      threads,
      updateDraft,
    ]
  );
}
