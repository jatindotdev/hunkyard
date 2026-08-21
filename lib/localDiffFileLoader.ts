import type {
  FileContents,
  FileDiffContentsLoader,
  FileDiffLoadedFiles,
  FileDiffMetadata,
} from '@pierre/diffs';

import { encodeLocalDiffPath } from './localDiffSource';

const DEFAULT_ENDPOINT = '/api/local-file';

// One side is empty by definition for these, so there is nothing to fetch.
const UNHYDRATABLE = new Set(['new', 'deleted']);

interface LocalDiffFileLoaderOptions {
  endpoint?: string;
  repoId?: string;
}

function isFileContents(value: unknown): value is FileContents {
  if (typeof value !== 'object' || value == null) return false;
  const candidate = value as { name?: unknown; contents?: unknown };
  return (
    typeof candidate.name === 'string' && typeof candidate.contents === 'string'
  );
}

// The renderer will happily hydrate a malformed response into a blank file, so
// the shape is checked rather than trusted.
function normalize(
  payload: unknown,
  fileDiff: FileDiffMetadata
): FileDiffLoadedFiles {
  if (typeof payload !== 'object' || payload == null) {
    throw new Error('Local file loader returned an invalid response.');
  }
  const { oldFile, newFile } = payload as {
    oldFile?: unknown;
    newFile?: unknown;
  };

  if (!isFileContents(newFile)) {
    throw new Error('Local file loader returned no new-side contents.');
  }

  if (fileDiff.type === 'rename-pure') {
    // The library's own type has no {oldFile, newFile: null} variant, and a
    // pure rename must report the old side as absent.
    if (oldFile != null) {
      throw new Error(
        'Local file loader returned an old side for a pure rename.'
      );
    }
    return { oldFile: null, newFile };
  }

  if (!isFileContents(oldFile)) {
    throw new Error('Local file loader returned no old-side contents.');
  }
  return { oldFile, newFile };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // fall through to the status line
  }
  return `${response.status} ${response.statusText}`;
}

// Builds the loader @pierre/diffs calls when a collapsed region needs the whole
// file. Returns undefined for change types that cannot be hydrated, which is
// how the renderer knows not to offer expansion.
export function createLocalDiffFileLoader(
  target: string | undefined,
  options: LocalDiffFileLoaderOptions = {}
): FileDiffContentsLoader {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const { repoId } = options;
  // Requests are keyed by the blob ids in the patch, so a file that changed on
  // disk is refetched while an unchanged one is served from here.
  const cache = new Map<string, Promise<FileDiffLoadedFiles>>();

  return async (fileDiff: FileDiffMetadata) => {
    if (UNHYDRATABLE.has(fileDiff.type)) {
      throw new Error(
        `Local file loader cannot hydrate ${fileDiff.type} diffs.`
      );
    }

    const cacheKey = [
      fileDiff.type,
      fileDiff.prevName ?? '',
      fileDiff.name,
      fileDiff.prevObjectId ?? '',
      fileDiff.newObjectId ?? '',
    ].join('\0');

    const cached = cache.get(cacheKey);
    if (cached != null) return cached;

    const params = new URLSearchParams({
      name: fileDiff.name,
      type: fileDiff.type,
    });
    if (target != null) params.set('target', target);
    if (repoId != null) params.set('repo', repoId);
    if (fileDiff.prevName != null) params.set('prevName', fileDiff.prevName);

    const promise = (async () => {
      const response = await fetch(`${endpoint}?${params}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(
          `Local file loader failed (${response.status}): ${await readError(response)}`
        );
      }
      return normalize(await response.json(), fileDiff);
    })();

    cache.set(cacheKey, promise);
    // A failed load must not be remembered, or a transient error would
    // permanently disable expansion for that file.
    promise.catch(() => cache.delete(cacheKey));
    return promise;
  };
}

export function localViewerHref(target: string | undefined): string {
  return encodeLocalDiffPath(target);
}
