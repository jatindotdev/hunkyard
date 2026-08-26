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
  browser = await Browser.launch();
  await browser.open(`http://127.0.0.1:${server.port}/`);
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

function settle(ms = 900): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BODY = 'document.body.innerText';

// Typed rather than pressed: a path contains characters the key protocol needs
// modifiers for, and what matters here is what the field reacts to.
async function type(text: string): Promise<void> {
  await browser.evaluate(`(() => {
    const el = document.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await settle();
}

describe.skipIf(!available)('the opener in a real browser', () => {
  test('a path lists the folders under it', async () => {
    await type(`${base}/`);
    const text = await browser.evaluate<string>(BODY);
    expect(text).toContain('FOLDERS');
    expect(text).toContain('repo');
    expect(text.toLowerCase()).toContain('git');
  });

  test('a pull request is recognised without any network', async () => {
    await type('oven-sh/bun#30412');
    const text = await browser.evaluate<string>(BODY);
    expect(text).toContain('PULL REQUEST');
    expect(text).toContain('oven-sh/bun/pull/30412');
  });

  test('choosing a repository narrows to what it has to review', async () => {
    await type(`${base}/repo`);
    await browser.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('open this repository') || b.innerText.startsWith('repo')).click(), 'ok'`
    );
    await settle(2500);

    expect(await browser.evaluate<string>('location.search')).toStartWith(
      '?repo=repo-'
    );
    const text = await browser.evaluate<string>(BODY);
    expect(text).toContain('UNCOMMITTED');
    expect(text).toContain('Working tree');
    // One tracked file was changed after the commit, and nothing was staged.
    expect(text).toContain('1 file');
  });

  test('typing inside a repository searches its refs and commits', async () => {
    await type('first');
    const text = await browser.evaluate<string>(BODY);
    expect(text).toContain('COMMITS');
    expect(text).toContain('first');
  });

  test('choosing a target opens the review', async () => {
    await type('');
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

  // The chip sits before the cursor, so backspace removing it is the same
  // gesture as deleting the last thing typed -- and the footer only offers it
  // while there is nothing else left to delete.
  test('backspace on an empty field leaves the repository', async () => {
    // The case above navigated into the review. Back is the opener, still
    // scoped -- and going back rather than reloading keeps this to one page
    // load for the whole file.
    await browser.evaluate('history.back(), "ok"');
    await settle(1200);
    expect(await browser.evaluate<string>('location.search')).toStartWith(
      '?repo=repo-'
    );

    await type('');
    expect(await browser.evaluate<string>(BODY)).toContain(
      'leave this repository'
    );

    await browser.press('Backspace');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await browser.evaluate<string>('location.search')).toBe('');
  });
});
