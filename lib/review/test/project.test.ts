import { describe, expect, test } from 'bun:test';

import { areAnnotationsEqual, projectAnnotations } from '../project';
import type { Thread, ThreadAnchor } from '../types';

const anchor = (path: string, line: number, extra: Partial<ThreadAnchor> = {}): ThreadAnchor => ({
  path,
  line,
  side: 'RIGHT',
  commitId: 'sha',
  ...extra,
});

const thread = (id: string, a: ThreadAnchor): Thread => ({
  id,
  anchor: a,
  comments: [
    { id: 'c', author: { login: 'x' }, body: 'b', createdAt: '2026-01-01T00:00:00Z', pending: false },
  ],
  resolved: false,
  outdated: false,
});

// Item ids carry decoration in reality, so the mapping is deliberately not an
// identity function in these tests.
const mapping = (paths: Record<string, string>) => (path: string) => paths[path];

describe('projectAnnotations', () => {
  test('places a thread on the item for its file', () => {
    const result = projectAnnotations(
      [thread('t1', anchor('src/a.ts', 10))],
      [],
      mapping({ 'src/a.ts': 'Commit 1/src/a.ts' })
    );
    expect([...result.keys()]).toEqual(['Commit 1/src/a.ts']);
    expect(result.get('Commit 1/src/a.ts')).toEqual([
      { side: 'additions', lineNumber: 10, metadata: { kind: 'thread', threadId: 't1' } },
    ]);
  });

  test('a LEFT anchor lands on the deletions side', () => {
    const result = projectAnnotations(
      [thread('t1', anchor('a.ts', 4, { side: 'LEFT' }))],
      [],
      mapping({ 'a.ts': 'a.ts' })
    );
    expect(result.get('a.ts')?.[0].side).toBe('deletions');
  });

  test('a thread on a file not in this diff is skipped, not thrown', () => {
    // It stays in the store; there is simply nowhere to draw it.
    const result = projectAnnotations(
      [thread('t1', anchor('deleted/elsewhere.ts', 1))],
      [],
      mapping({})
    );
    expect(result.size).toBe(0);
  });

  test('several threads on one file group under one item', () => {
    const result = projectAnnotations(
      [thread('t1', anchor('a.ts', 3)), thread('t2', anchor('a.ts', 9))],
      [],
      mapping({ 'a.ts': 'a.ts' })
    );
    expect(result.get('a.ts')).toHaveLength(2);
  });

  test('drafts render after threads on the same line', () => {
    // A reply box belongs below the conversation, not above it.
    const result = projectAnnotations(
      [thread('t1', anchor('a.ts', 5))],
      [{ id: 'draft-0', anchor: anchor('a.ts', 5) }],
      mapping({ 'a.ts': 'a.ts' })
    );
    expect(result.get('a.ts')?.map((x) => x.metadata.kind)).toEqual([
      'thread',
      'draft',
    ]);
  });

  test('several drafts coexist', () => {
    // The single-draft limit is the specific thing being removed: writing a few
    // comments before submitting has to be possible.
    const result = projectAnnotations(
      [],
      [
        { id: 'draft-0', anchor: anchor('a.ts', 1) },
        { id: 'draft-1', anchor: anchor('a.ts', 2) },
        { id: 'draft-2', anchor: anchor('b.ts', 3) },
      ],
      mapping({ 'a.ts': 'a.ts', 'b.ts': 'b.ts' })
    );
    expect(result.get('a.ts')).toHaveLength(2);
    expect(result.get('b.ts')).toHaveLength(1);
  });

  test('a multi-line thread renders once, at the end of the range', () => {
    const result = projectAnnotations(
      [thread('t1', anchor('a.ts', 14, { startLine: 8 }))],
      [],
      mapping({ 'a.ts': 'a.ts' })
    );
    expect(result.get('a.ts')).toHaveLength(1);
    expect(result.get('a.ts')?.[0].lineNumber).toBe(14);
  });

  test('nothing in, nothing out', () => {
    expect(projectAnnotations([], [], mapping({})).size).toBe(0);
  });
});

describe('areAnnotationsEqual', () => {
  const a = { side: 'additions', lineNumber: 1, metadata: { kind: 'thread', threadId: 't1' } } as const;

  test('identical lists are equal', () => {
    expect(areAnnotationsEqual([a], [{ ...a }])).toBe(true);
  });

  test('undefined and empty are equal, so an untouched item is not bumped', () => {
    expect(areAnnotationsEqual(undefined, [])).toBe(true);
    expect(areAnnotationsEqual([], undefined)).toBe(true);
  });

  test('a different id, line, side or kind is not equal', () => {
    expect(areAnnotationsEqual([a], [{ ...a, metadata: { kind: 'thread', threadId: 't2' } }])).toBe(false);
    expect(areAnnotationsEqual([a], [{ ...a, lineNumber: 2 }])).toBe(false);
    expect(areAnnotationsEqual([a], [{ ...a, side: 'deletions' }])).toBe(false);
    expect(areAnnotationsEqual([a], [{ ...a, metadata: { kind: 'draft', draftId: 't1' } }])).toBe(false);
  });

  test('a different length is not equal', () => {
    expect(areAnnotationsEqual([a], [a, a])).toBe(false);
  });
});
