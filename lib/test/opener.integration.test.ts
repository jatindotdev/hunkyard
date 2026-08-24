import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../git/exec';
import { startServer } from '../../server/index';
import { Browser, chromeAvailable } from './browser';

// The opener in a real browser. One page load, because Browser.open settles for
// eleven seconds; everything after that is driven in-page.
const available = await chromeAvailable();

let base: string;
let repo: string;
let previousState: string | undefined;
let previousRoot: string | undefined;
let server: { port: number; stop(): void };
let browser: Browser;
let origin: string;

beforeAll(async () => {
  if (!available) return;

  base = await mkdtemp(join(tmpdir(), 'hunk-opener-'));
  repo = join(base, 'repo');
  await Bun.write(join(repo, '.keep'), '');
  await runGit(['init', '-q', '-b', 'main'], { cwd: repo });
  await runGit(['config', 'user.email', 'test@example.com'], { cwd: repo });
  await runGit(['config', 'user.name', 'Test'], { cwd: repo });
  await runGit(['config', 'commit.gpgsign', 'false'], { cwd: repo });
  await writeFile(join(repo, 'math.ts'), 'export const add = 1;\n');
  await runGit(['add', '-A'], { cwd: repo });
  await runGit(['commit', '-qm', 'first'], { cwd: repo });
  await writeFile(join(repo, 'math.ts'), 'export const add = 2;\n');

  previousState = process.env.XDG_STATE_HOME;
  previousRoot = process.env.HUNKYARD_REPO_ROOT;
  process.env.XDG_STATE_HOME = join(base, 'state');
  process.env.HUNKYARD_REPO_ROOT = repo;

  server = startServer({ port: 0 });
  origin = `http://127.0.0.1:${server.port}`;
  browser = await Browser.launch();
  await browser.open(`${origin}/?path=${encodeURIComponent(base)}`);
}, 60_000);

afterAll(async () => {
  if (!available) return;
  await browser?.close();
  server?.stop();
  if (previousState == null) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousState;
  if (previousRoot == null) delete process.env.HUNKYARD_REPO_ROOT;
  else process.env.HUNKYARD_REPO_ROOT = previousRoot;
  await rm(base, { recursive: true, force: true });
});

function settle(ms = 800): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BODY = 'document.body.innerText';

describe.skipIf(!available)('the opener in a real browser', () => {
  test('lists the folder and marks the repository in it', async () => {
    const text = await browser.evaluate<string>(BODY);
    expect(text).toContain('repo');
    expect(text.toLowerCase()).toContain('git');
  });

  test('opening the repository lands on the target picker', async () => {
    await browser.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('repo')).click(), 'ok'`
    );
    await settle();

    expect(await browser.evaluate<string>('location.search')).toStartWith(
      '?repo=repo-'
    );
    const text = await browser.evaluate<string>(BODY);
    expect(text).toContain('Working tree');
    expect(text).toContain('Recent commits');
  });

  test('the picker counts what is actually uncommitted', async () => {
    // One tracked file was changed after the commit, and nothing was staged.
    expect(await browser.evaluate<string>(BODY)).toContain('1 file');
  });

  test('picking the working tree opens the review', async () => {
    await browser.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('Working tree')).click(), 'ok'`
    );
    await settle(3000);

    expect(await browser.evaluate<string>('location.pathname')).toBe('/local');
    expect(
      await browser.evaluate<string>(
        `document.querySelector('diffs-container')?.shadowRoot?.textContent ?? ''`
      )
    ).toContain('export const add');
  });

  // Committing a repository pushes and stepping between folders replaces, so
  // Back from a review is the picker rather than a folder on the way there.
  test('back from the review is the picker', async () => {
    await browser.evaluate('history.back(), "ok"');
    await settle();
    expect(await browser.evaluate<string>('location.search')).toStartWith(
      '?repo=repo-'
    );
  });
});
