'use client';

import { useCallback, useRef, useState } from 'react';

const KEY_PREFIX = 'hunkyard:viewed:';

// A file is remembered as viewed together with the blob id it was viewed at, so
// a later change to that one file can drop it back to unviewed on its own. The
// alternative -- keying the whole set on the head commit -- would un-view every
// file in the review whenever any single one of them changed.
export type ViewedRecord = Record<string, string>;

// A pure rename carries no `index` line, so there is no blob id to compare
// against; the rename itself is the only thing to review.
const NO_BLOB = 'none';

export interface ViewedFile {
  path: string;
  blobId: string | undefined;
}

// A viewed record's stored value for a file, so an absent blob id and a real one
// are compared the same way.
export function blobKey(blobId: string | undefined): string {
  return blobId ?? NO_BLOB;
}

// Drops the files whose contents changed since they were marked viewed. Files
// absent from `files` are left alone: a streamed diff publishes in batches, so
// "not here yet" and "no longer in the review" look identical mid-load.
// Returns the same record when nothing changed, so callers can skip a write.
export function pruneChangedFiles(
  record: ViewedRecord,
  files: readonly ViewedFile[]
): ViewedRecord {
  let next: ViewedRecord | null = null;
  for (const file of files) {
    const seen = record[file.path];
    if (seen == null || seen === blobKey(file.blobId)) continue;
    next ??= { ...record };
    delete next[file.path];
  }
  return next ?? record;
}

export interface ViewedFilesApi {
  // Paths with a viewed record, for decorating the file tree. A file whose
  // contents changed since it was marked viewed is still in here until the next
  // reconcile; `isViewedAt` is the exact answer and does not lag.
  viewedPaths: ReadonlySet<string>;
  isViewedAt(path: string, blobId: string | undefined): boolean;
  setViewed(file: ViewedFile, viewed: boolean): void;
  reconcile(files: readonly ViewedFile[]): void;
  clear(): void;
}

function readRecord(key: string): ViewedRecord {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored == null) return {};
    const parsed: unknown = JSON.parse(stored);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const record: ViewedRecord = {};
    for (const [path, blobId] of Object.entries(parsed)) {
      if (typeof blobId === 'string') record[path] = blobId;
    }
    return record;
  } catch {
    return {};
  }
}

function writeRecord(key: string, record: ViewedRecord): void {
  try {
    if (Object.keys(record).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage being unavailable must not break the checkbox it backs.
  }
}

// Which files a reviewer has already been through, per review: a pull request or
// a local target each get their own key, so switching between them does not mix
// two reviews' progress.
export function useViewedFiles(reviewKey: string): ViewedFilesApi {
  const key = KEY_PREFIX + reviewKey;
  const keyRef = useRef(key);
  const recordRef = useRef<ViewedRecord | null>(null);
  const [viewedPaths, setViewedPaths] = useState<ReadonlySet<string>>(
    () => new Set(Object.keys(readRecord(key)))
  );

  // Switching review without remounting has to swap stores, not merge them.
  if (keyRef.current !== key) {
    keyRef.current = key;
    recordRef.current = null;
  }
  if (recordRef.current == null) {
    recordRef.current = readRecord(key);
  }

  const commit = useCallback((record: ViewedRecord) => {
    recordRef.current = record;
    writeRecord(keyRef.current, record);
    setViewedPaths(new Set(Object.keys(record)));
  }, []);

  const setViewed = useCallback(
    (file: ViewedFile, viewed: boolean) => {
      const record = { ...(recordRef.current ?? {}) };
      if (viewed) record[file.path] = blobKey(file.blobId);
      else delete record[file.path];
      commit(record);
    },
    [commit]
  );

  const reconcile = useCallback(
    (files: readonly ViewedFile[]) => {
      const record = recordRef.current ?? {};
      const next = pruneChangedFiles(record, files);
      if (next !== record) commit(next);
    },
    [commit]
  );

  const clear = useCallback(() => {
    commit({});
  }, [commit]);

  const isViewedAt = useCallback(
    (path: string, blobId: string | undefined) =>
      (recordRef.current ?? {})[path] === blobKey(blobId),
    // recordRef is what holds the answer, but viewedPaths is what changes when
    // it does, so this has to be re-created on each change or callers memoized
    // on it would keep a stale reading.
    [viewedPaths]
  );

  return { viewedPaths, isViewedAt, setViewed, reconcile, clear };
}
