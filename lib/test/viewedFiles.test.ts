import { describe, expect, test } from 'bun:test';

import { blobKey, pruneChangedFiles } from '@/components/useViewedFiles';

describe('pruneChangedFiles', () => {
  test('keeps a file whose contents are unchanged', () => {
    const record = { 'src/a.ts': 'aaa' };
    expect(
      pruneChangedFiles(record, [{ path: 'src/a.ts', blobId: 'aaa' }])
    ).toBe(record);
  });

  test('drops a file whose contents changed since it was viewed', () => {
    expect(
      pruneChangedFiles({ 'src/a.ts': 'aaa', 'src/b.ts': 'bbb' }, [
        { path: 'src/a.ts', blobId: 'ccc' },
      ])
    ).toEqual({ 'src/b.ts': 'bbb' });
  });

  // A streamed diff publishes in batches, so a file that has not arrived yet
  // must not be mistaken for one that left the review.
  test('leaves a file absent from the batch alone', () => {
    const record = { 'src/a.ts': 'aaa' };
    expect(pruneChangedFiles(record, [])).toBe(record);
    expect(
      pruneChangedFiles(record, [{ path: 'src/b.ts', blobId: 'bbb' }])
    ).toBe(record);
  });

  test('does not mutate the record it was given', () => {
    const record = { 'src/a.ts': 'aaa' };
    pruneChangedFiles(record, [{ path: 'src/a.ts', blobId: 'zzz' }]);
    expect(record).toEqual({ 'src/a.ts': 'aaa' });
  });

  // A pure rename carries no `index` line, so both sides are undefined and the
  // sentinel has to compare equal to itself rather than dropping every time.
  test('treats a file with no blob id as unchanged against itself', () => {
    const record = { 'src/a.ts': blobKey(undefined) };
    expect(
      pruneChangedFiles(record, [{ path: 'src/a.ts', blobId: undefined }])
    ).toBe(record);
  });
});
