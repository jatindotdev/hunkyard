import { describe, expect, test } from 'bun:test';

import {
  describeLocalTarget,
  encodeLocalDiffPath,
  parseLocalDiffSource,
} from '@/lib/local/diffSource';

describe('parseLocalDiffSource', () => {
  test('ignores paths that are not local', () => {
    expect(parseLocalDiffSource([])).toBeNull();
    expect(parseLocalDiffSource(['owner', 'repo', 'pull', '1'])).toBeNull();
    // A repository literally named "local" would still be owner/repo shaped.
    expect(parseLocalDiffSource(['locally', 'x'])).toBeNull();
  });

  test('bare /local means the working tree', () => {
    expect(parseLocalDiffSource(['local'])).toEqual({
      kind: 'local',
      target: undefined,
    });
  });

  test('decodes an encoded revspec', () => {
    expect(parseLocalDiffSource(['local', 'main...feature'])).toEqual({
      kind: 'local',
      target: 'main...feature',
    });
    expect(
      parseLocalDiffSource(['local', encodeURIComponent('origin/main...feature/x')])
    ).toEqual({ kind: 'local', target: 'origin/main...feature/x' });
  });

  test('rejoins a hand-typed revspec that was not encoded', () => {
    // Slashes in refs are ordinary, so a pasted path must not 404.
    expect(
      parseLocalDiffSource(['local', 'origin', 'main...feature'])
    ).toEqual({ kind: 'local', target: 'origin/main...feature' });
  });

  test('treats an empty or whitespace spec as the working tree', () => {
    expect(parseLocalDiffSource(['local', ''])?.target).toBeUndefined();
    expect(parseLocalDiffSource(['local', '%20'])?.target).toBeUndefined();
  });

  test('round-trips through encodeLocalDiffPath', () => {
    for (const target of [
      undefined,
      '--staged',
      'main...feature',
      'origin/main...feature/x',
      'HEAD~3',
      'v1.2.3',
    ]) {
      const path = encodeLocalDiffPath(target);
      const segments = path.split('/').filter((s) => s !== '');
      expect(parseLocalDiffSource(segments)?.target).toBe(target);
    }
  });
});

describe('describeLocalTarget', () => {
  test('names the implicit targets in words', () => {
    expect(describeLocalTarget(undefined)).toBe('working tree');
    expect(describeLocalTarget('--staged')).toBe('staged changes');
    expect(describeLocalTarget('--all')).toBe('all uncommitted changes');
  });

  test('passes a revspec through unchanged', () => {
    expect(describeLocalTarget('main...feature')).toBe('main...feature');
  });
});
