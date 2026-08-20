import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalThreadStore } from '../LocalThreadStore';
import type { ThreadAnchor } from '../types';

let repo: string;
let store: LocalThreadStore;

const anchor = (
  path: string,
  line: number,
  overrides: Partial<ThreadAnchor> = {}
): ThreadAnchor => ({
  path,
  line,
  side: 'RIGHT',
  commitId: 'abc1234',
  ...overrides,
});

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'hunkyard-store-'));
  store = new LocalThreadStore(repo, 'main...feature', 'jatin');
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

const reviewFile = () => join(repo, '.hunkyard', 'review.md');

describe('starting a review', () => {
  test('no file yet means no threads, not an error', async () => {
    expect(await store.list()).toEqual([]);
    expect(existsSync(reviewFile())).toBe(false);
  });

  test('the first comment creates the file', async () => {
    await store.add({ anchor: anchor('src/a.ts', 10), body: 'Needs a test.' });
    expect(existsSync(reviewFile())).toBe(true);
    const threads = await store.list();
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].body).toBe('Needs a test.');
    expect(threads[0].comments[0].author.login).toBe('jatin');
  });

  test('the file is readable markdown with an actionable anchor', async () => {
    await store.add({ anchor: anchor('src/a.ts', 10), body: 'Needs a test.' });
    const text = readFileSync(reviewFile(), 'utf8');
    // An agent handed this file should be able to act on the heading alone.
    expect(text).toContain('## src/a.ts:10');
    expect(text).toContain('Needs a test.');
  });
});

describe('replies', () => {
  test('a reply joins the existing thread rather than starting one', async () => {
    const created = await store.add({
      anchor: anchor('src/a.ts', 10),
      body: 'First.',
    });
    await store.add({ replyToThreadId: created.id, anchor: created.anchor, body: 'Second.' });

    const threads = await store.list();
    expect(threads).toHaveLength(1);
    expect(threads[0].comments.map((c) => c.body)).toEqual(['First.', 'Second.']);
  });

  test('replying to a thread that does not exist is an error', async () => {
    await expect(
      store.add({ replyToThreadId: 't_nope', anchor: anchor('a.ts', 1), body: 'x' })
    ).rejects.toThrow(/t_nope/);
  });
});

describe('ordering', () => {
  test('threads are ordered by file then line, not by when they were written', async () => {
    // Someone reviewing walks the diff top to bottom; the file should read the
    // same way even if the comments were written out of order.
    await store.add({ anchor: anchor('src/z.ts', 5), body: 'z5' });
    await store.add({ anchor: anchor('src/a.ts', 20), body: 'a20' });
    await store.add({ anchor: anchor('src/a.ts', 3), body: 'a3' });

    const threads = await store.list();
    expect(
      threads.map((t) => `${t.anchor.path}:${t.anchor.line}`)
    ).toEqual(['src/a.ts:3', 'src/a.ts:20', 'src/z.ts:5']);
  });
});

describe('removal', () => {
  test('removing the last comment removes the thread', async () => {
    const created = await store.add({ anchor: anchor('a.ts', 1), body: 'only' });
    await store.remove(created.id, created.comments[0].id);
    expect(await store.list()).toEqual([]);
  });

  test('removing one of several leaves the thread', async () => {
    const created = await store.add({ anchor: anchor('a.ts', 1), body: 'first' });
    await store.add({ replyToThreadId: created.id, anchor: created.anchor, body: 'second' });
    const threads = await store.list();
    await store.remove(created.id, threads[0].comments[0].id);
    const after = await store.list();
    expect(after).toHaveLength(1);
    expect(after[0].comments.map((c) => c.body)).toEqual(['second']);
  });

  test('removing something that is not there is not an error', async () => {
    await store.remove('t_nope', 'c_nope');
    expect(await store.list()).toEqual([]);
  });
});

describe('resolve', () => {
  test('resolved state persists', async () => {
    const created = await store.add({ anchor: anchor('a.ts', 1), body: 'x' });
    await store.setResolved(created.id, true);
    expect((await store.list())[0].resolved).toBe(true);
    await store.setResolved(created.id, false);
    expect((await store.list())[0].resolved).toBe(false);
  });
});

describe('durability, which is the whole point', () => {
  test('threads survive a new store instance', async () => {
    await store.add({ anchor: anchor('a.ts', 1), body: 'survives' });
    // The layer this replaces kept comments in React state, so every reload
    // lost them -- and a local review reloads on every file save.
    const reopened = new LocalThreadStore(repo, 'main...feature', 'jatin');
    expect((await reopened.list())[0].comments[0].body).toBe('survives');
  });

  test('a hand-edited comment body is read back', async () => {
    await store.add({ anchor: anchor('a.ts', 1), body: 'original' });
    const text = readFileSync(reviewFile(), 'utf8');
    writeFileSync(reviewFile(), text.replace('original', 'edited by hand'));
    expect((await store.list())[0].comments[0].body).toBe('edited by hand');
  });

  test('multi-line and LEFT-side anchors survive a round trip', async () => {
    await store.add({
      anchor: anchor('a.ts', 13, { startLine: 8, side: 'LEFT', startSide: 'LEFT' }),
      body: 'on the removed lines',
    });
    const [thread] = await store.list();
    expect(thread.anchor.startLine).toBe(8);
    expect(thread.anchor.line).toBe(13);
    expect(thread.anchor.side).toBe('LEFT');
  });

  test('the commit it was written against is kept', async () => {
    await store.add({
      anchor: anchor('a.ts', 1, { commitId: 'deadbee' }),
      body: 'x',
    });
    expect((await store.list())[0].anchor.commitId).toBe('deadbee');
  });
});

describe('submit', () => {
  test('does nothing, because writes already went through', async () => {
    expect(store.batches).toBe(false);
    await store.add({ anchor: anchor('a.ts', 1), body: 'x' });
    await store.submit({ event: 'COMMENT' });
    expect(await store.list()).toHaveLength(1);
  });
});
