import { describe, expect, test } from 'bun:test';

import { parseReview, serializeReview } from '../markdown';
import type { Thread } from '../types';

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't_1',
    anchor: {
      path: 'src/cart.ts',
      line: 14,
      side: 'RIGHT',
      commitId: '0cb9a37',
    },
    comments: [
      {
        id: 'c_1',
        author: { login: 'jatin' },
        body: 'This reduce is harder to read than the loop it replaced.',
        createdAt: '2026-08-21T10:00:00Z',
        pending: false,
      },
    ],
    resolved: false,
    outdated: false,
    ...overrides,
  };
}

describe('round trip', () => {
  test('a single thread survives serialize then parse', () => {
    const doc = { target: 'main...feature', threads: [thread()] };
    const parsed = parseReview(serializeReview(doc));
    expect(parsed.target).toBe('main...feature');
    expect(parsed.threads).toHaveLength(1);
    expect(parsed.threads[0]).toEqual(thread());
  });

  test('a multi-line LEFT-side anchor survives', () => {
    const t = thread({
      id: 't_2',
      anchor: {
        path: 'src/cart.ts',
        line: 13,
        startLine: 8,
        side: 'LEFT',
        startSide: 'LEFT',
        commitId: 'abc1234',
      },
    });
    const parsed = parseReview(serializeReview({ target: 'x', threads: [t] }));
    expect(parsed.threads[0].anchor).toEqual(t.anchor);
  });

  test('several comments in one thread keep their order and authors', () => {
    const t = thread({
      comments: [
        { id: 'c_1', author: { login: 'jatin' }, body: 'First point.', createdAt: '2026-08-21T10:00:00Z', pending: false },
        { id: 'c_2', author: { login: 'claude' }, body: 'Second point.', createdAt: '2026-08-21T10:05:00Z', pending: false },
      ],
    });
    const parsed = parseReview(serializeReview({ target: 'x', threads: [t] }));
    expect(parsed.threads[0].comments.map((c) => c.body)).toEqual([
      'First point.',
      'Second point.',
    ]);
    expect(parsed.threads[0].comments.map((c) => c.author.login)).toEqual([
      'jatin',
      'claude',
    ]);
  });

  test('resolved state survives', () => {
    const parsed = parseReview(
      serializeReview({ target: 'x', threads: [thread({ resolved: true })] })
    );
    expect(parsed.threads[0].resolved).toBe(true);
  });

  test('multiple threads survive', () => {
    const threads = [
      thread({ id: 't_1' }),
      thread({ id: 't_2', anchor: { path: 'src/tax.ts', line: 2, side: 'RIGHT', commitId: 'sha' } }),
    ];
    const parsed = parseReview(serializeReview({ target: 'x', threads }));
    expect(parsed.threads.map((t) => t.id)).toEqual(['t_1', 't_2']);
  });

  test('a multi-paragraph body keeps its blank lines', () => {
    const t = thread({
      comments: [
        {
          id: 'c_1',
          author: { login: 'jatin' },
          body: 'First paragraph.\n\nSecond paragraph.',
          createdAt: '2026-08-21T10:00:00Z',
          pending: false,
        },
      ],
    });
    const parsed = parseReview(serializeReview({ target: 'x', threads: [t] }));
    expect(parsed.threads[0].comments[0].body).toBe(
      'First paragraph.\n\nSecond paragraph.'
    );
  });

  test('a fenced code block in a body survives', () => {
    // Review comments contain code constantly, and a fence contains lines that
    // look like markdown structure.
    const body = 'Try:\n\n```ts\nconst x = 1;\n```';
    const t = thread({
      comments: [
        { id: 'c_1', author: { login: 'jatin' }, body, createdAt: '2026-08-21T10:00:00Z', pending: false },
      ],
    });
    const parsed = parseReview(serializeReview({ target: 'x', threads: [t] }));
    expect(parsed.threads[0].comments[0].body).toBe(body);
  });
});

describe('readability', () => {
  test('the heading is a path:line an agent can act on', () => {
    const out = serializeReview({ target: 'x', threads: [thread()] });
    expect(out).toContain('## src/cart.ts:14');
  });

  test('a range heading shows both ends, and names the deleted side', () => {
    const out = serializeReview({
      target: 'x',
      threads: [
        thread({
          anchor: { path: 'a.ts', line: 13, startLine: 8, side: 'LEFT', startSide: 'LEFT', commitId: 's' },
        }),
      ],
    });
    expect(out).toContain('## a.ts:8-13 (deleted side)');
  });

  test('machine fields are HTML comments, so they render as nothing', () => {
    const out = serializeReview({ target: 'x', threads: [thread()] });
    for (const line of out.split('\n')) {
      if (line.includes('thread=') || line.includes('comment=')) {
        expect(line.trimStart().startsWith('<!--')).toBe(true);
      }
    }
  });
});

describe('tolerance of hand editing', () => {
  test('an empty file parses to nothing rather than throwing', () => {
    expect(parseReview('')).toEqual({ target: '', threads: [] });
  });

  test('prose added by hand between threads is ignored', () => {
    const out = serializeReview({ target: 'x', threads: [thread()] });
    const edited = out.replace(
      '## src/cart.ts:14',
      'Some note I typed.\n\n## src/cart.ts:14'
    );
    expect(parseReview(edited).threads).toHaveLength(1);
  });

  test('a thread whose metadata was mangled is skipped, not fatal', () => {
    const good = thread({ id: 't_good' });
    const out = serializeReview({ target: 'x', threads: [good] });
    const broken = `## nonsense\n\nno metadata here\n\n${out}`;
    // The good thread still comes back.
    expect(parseReview(broken).threads.map((t) => t.id)).toContain('t_good');
  });

  test('a body edited by hand is read back', () => {
    const out = serializeReview({ target: 'x', threads: [thread()] });
    const edited = out.replace(
      'This reduce is harder to read than the loop it replaced.',
      'Rewritten by hand.'
    );
    expect(parseReview(edited).threads[0].comments[0].body).toBe(
      'Rewritten by hand.'
    );
  });
});
