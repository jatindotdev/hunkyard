import { describe, expect, test } from 'bun:test';

import { groupCommentsIntoThreads, pendingToThread } from '../GitHubThreadStore';
import type { GitHubReviewComment } from '../github';

function raw(overrides: Partial<GitHubReviewComment>): GitHubReviewComment {
  return {
    id: 1,
    node_id: 'n1',
    path: 'src/a.ts',
    body: 'body',
    line: 10,
    original_line: 10,
    start_line: null,
    side: 'RIGHT',
    start_side: null,
    commit_id: 'sha',
    created_at: '2026-08-21T10:00:00Z',
    updated_at: '2026-08-21T10:00:00Z',
    user: { login: 'jatin', avatar_url: 'https://x/y.png' },
    ...overrides,
  };
}

describe('groupCommentsIntoThreads', () => {
  test('a flat list with no replies is one thread per comment', () => {
    const threads = groupCommentsIntoThreads([
      raw({ id: 1, path: 'a.ts' }),
      raw({ id: 2, path: 'b.ts' }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.id)).toEqual(['1', '2']);
  });

  test('replies collapse into the root thread', () => {
    const threads = groupCommentsIntoThreads([
      raw({ id: 1, body: 'root' }),
      raw({ id: 2, body: 'reply', in_reply_to_id: 1 }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments.map((c) => c.body)).toEqual(['root', 'reply']);
  });

  test('a reply to a reply still lands on the root', () => {
    // GitHub sets in_reply_to_id to the immediate parent, so the chain has to
    // be walked rather than read once.
    const threads = groupCommentsIntoThreads([
      raw({ id: 1, body: 'root' }),
      raw({ id: 2, body: 'first', in_reply_to_id: 1 }),
      raw({ id: 3, body: 'second', in_reply_to_id: 2 }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments).toHaveLength(3);
    expect(threads[0].id).toBe('1');
  });

  test('comments are ordered oldest first regardless of arrival order', () => {
    const threads = groupCommentsIntoThreads([
      raw({ id: 2, body: 'later', in_reply_to_id: 1, created_at: '2026-08-21T12:00:00Z' }),
      raw({ id: 1, body: 'earlier', created_at: '2026-08-21T10:00:00Z' }),
    ]);
    expect(threads[0].comments.map((c) => c.body)).toEqual(['earlier', 'later']);
  });

  test('the thread anchors on the root, not on a reply', () => {
    const threads = groupCommentsIntoThreads([
      raw({ id: 1, path: 'root.ts', line: 5 }),
      // A reply carries its own path/line fields; they must not win.
      raw({ id: 2, path: 'reply.ts', line: 99, in_reply_to_id: 1 }),
    ]);
    expect(threads[0].anchor.path).toBe('root.ts');
    expect(threads[0].anchor.line).toBe(5);
  });

  test('a reply whose parent is missing becomes its own thread', () => {
    // Pagination can cut a chain; dropping the comment entirely would be worse
    // than showing it detached.
    const threads = groupCommentsIntoThreads([
      raw({ id: 5, body: 'orphan', in_reply_to_id: 999 }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].body).toBe('orphan');
  });

  test('a self-referential chain does not hang', () => {
    const threads = groupCommentsIntoThreads([
      raw({ id: 1, in_reply_to_id: 1 }),
    ]);
    expect(threads).toHaveLength(1);
  });

  test('an outdated comment is flagged and keeps its original line', () => {
    // GitHub nulls `line` when it can no longer place the comment. Anchoring at
    // 0 would put it at the top of the file.
    const threads = groupCommentsIntoThreads([
      raw({ id: 1, line: null, original_line: 42 }),
    ]);
    expect(threads[0].outdated).toBe(true);
    expect(threads[0].anchor.line).toBe(42);
  });

  test('a current comment is not flagged outdated', () => {
    expect(groupCommentsIntoThreads([raw({ id: 1, line: 10 })])[0].outdated).toBe(
      false
    );
  });

  test('resolved state is joined by root comment id', () => {
    const threads = groupCommentsIntoThreads(
      [raw({ id: 1 }), raw({ id: 2, in_reply_to_id: 1 }), raw({ id: 3 })],
      new Map([[1, true]])
    );
    expect(threads.find((t) => t.id === '1')?.resolved).toBe(true);
    expect(threads.find((t) => t.id === '3')?.resolved).toBe(false);
  });

  test('a multi-line LEFT-side anchor is preserved', () => {
    const threads = groupCommentsIntoThreads([
      raw({ id: 1, line: 13, start_line: 8, side: 'LEFT', start_side: 'LEFT' }),
    ]);
    expect(threads[0].anchor).toMatchObject({
      line: 13,
      startLine: 8,
      side: 'LEFT',
      startSide: 'LEFT',
    });
  });

  test('a missing user does not throw', () => {
    // Deleted accounts come back as null.
    const threads = groupCommentsIntoThreads([raw({ id: 1, user: null })]);
    expect(threads[0].comments[0].author.login).toBe('unknown');
  });

  test('nothing in means nothing out', () => {
    expect(groupCommentsIntoThreads([])).toEqual([]);
  });
});

describe('pendingToThread', () => {
  test('marks the comment pending so the UI can show it as unsent', () => {
    const thread = pendingToThread({
      id: 'p_1',
      anchor: { path: 'a.ts', line: 3, side: 'RIGHT', commitId: 'sha' },
      body: 'queued',
      createdAt: '2026-08-21T10:00:00Z',
    });
    expect(thread.comments[0].pending).toBe(true);
    expect(thread.resolved).toBe(false);
    expect(thread.id).toBe('p_1');
  });
});
