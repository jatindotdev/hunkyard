import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../git/exec';
import { startServer } from '../../server/index';
import { Browser, chromeAvailable } from './browser';

// These drive the real app in a real browser, which is the only place the parts
// that matter can be checked: shadow DOM, a virtualized surface with real
// layout, a highlight worker pool, and key events that a listener sees.
const available = await chromeAvailable();

let repo: string;
let stateHome: string;
let previousState: string | undefined;
let previousRoot: string | undefined;
let server: { port: number; stop(): void };
let browser: Browser;
let url: string;

beforeAll(async () => {
  if (!available) return;

  const base = await mkdtemp(join(tmpdir(), 'hunk-ui-'));
  repo = join(base, 'repo');
  stateHome = join(base, 'state');
  await Bun.write(join(repo, '.keep'), '');
  await runGit(['init', '-q', '-b', 'main'], { cwd: repo });
  await runGit(['config', 'user.email', 'test@example.com'], { cwd: repo });
  await runGit(['config', 'user.name', 'Test'], { cwd: repo });
  await runGit(['config', 'commit.gpgsign', 'false'], { cwd: repo });
  await writeFile(join(repo, 'math.ts'), 'export const add = (a: number) => a;\n');
  await runGit(['add', '-A'], { cwd: repo });
  await runGit(['commit', '-qm', 'first'], { cwd: repo });
  await writeFile(
    join(repo, 'math.ts'),
    'export const add = (a: number) => a;\nexport const UI_MARKER = 42;\n'
  );

  // Isolated state, so the run neither reads nor writes the developer's own
  // registry, and an explicit root so resolution does not consult it at all.
  previousState = process.env.XDG_STATE_HOME;
  previousRoot = process.env.HUNKYARD_REPO_ROOT;
  process.env.XDG_STATE_HOME = stateHome;
  process.env.HUNKYARD_REPO_ROOT = repo;

  server = startServer({ port: 0 });

  // Ask the server for the id rather than deriving it. git resolves symlinks in
  // a temp path (/var becomes /private/var on macOS), so an id computed from the
  // path handed to mkdtemp does not match the one the server derives.
  const repos = (await (
    await fetch(`http://127.0.0.1:${server.port}/api/repos`)
  ).json()) as { defaultId: string | null };
  if (repos.defaultId == null) throw new Error('the server registered no repository');
  url = `http://127.0.0.1:${server.port}/local?repo=${encodeURIComponent(repos.defaultId)}`;
  browser = await Browser.launch();
  await browser.open(url);
}, 60_000);

afterAll(async () => {
  if (!available) return;
  await browser?.close();
  server?.stop();
  if (previousState == null) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousState;
  if (previousRoot == null) delete process.env.HUNKYARD_REPO_ROOT;
  else process.env.HUNKYARD_REPO_ROOT = previousRoot;
  await rm(repo, { recursive: true, force: true });
});

// Reads the diff surface, which renders into a shadow root.
const DIFF_TEXT = `document.querySelector('diffs-container')?.shadowRoot?.textContent ?? ''`;

describe.skipIf(!available)('the viewer in a real browser', () => {
  test('renders the working tree diff', async () => {
    expect(await browser.evaluate<string>(DIFF_TEXT)).toContain('UI_MARKER');
  });

  // One colour per token style. A file that failed to tokenise renders as a
  // single colour, so this is what tells highlighting apart from plain text.
  test('highlights it, through the worker pool', async () => {
    const colours = await browser.evaluate<number>(
      `new Set([...document.querySelector('diffs-container').shadowRoot
        .querySelectorAll('span[style*="--diffs-token"]')]
        .map((s) => s.getAttribute('style'))).size`
    );
    expect(colours).toBeGreaterThan(3);
  });

  test('shows the file line counts in the tree', async () => {
    const decorations = await browser.evaluate<string>(
      `[...document.querySelector('file-tree-container').shadowRoot
        .querySelectorAll('[data-item-section=decoration]')]
        .map((e) => e.textContent.trim()).join(' ')`
    );
    expect(decorations).toContain('+1');
  });

  // The opener, over the review, scoped to the repository already being read.
  // Its own surface rather than a menu, so this is the check that the two have
  // not come apart.
  test('opens the opener on Cmd-K, narrowed to this repository', async () => {
    await browser.press('Meta+k');
    await new Promise((resolve) => setTimeout(resolve, 900));

    try {
      // `aria-modal` is a claim; this is the part that makes it true. Focus
      // has to land on the field, stay inside, and go back afterwards.
      const focus = JSON.parse(
        await browser.evaluate<string>(`(() => {
          const overlay = document.querySelector('[data-opener-overlay]');
          const active = document.activeElement;
          return JSON.stringify({
            onField: active && active.getAttribute('role') === 'combobox',
            inside: overlay ? overlay.contains(active) : false,
          });
        })()`)
      ) as { onField: boolean; inside: boolean };
      expect(focus.onField).toBe(true);
      expect(focus.inside).toBe(true);

      for (let step = 0; step < 6; step += 1) await browser.press('Tab');
      expect(
        await browser.evaluate<boolean>(
          `!!document
            .querySelector('[data-opener-overlay]')
            ?.contains(document.activeElement)`
        )
      ).toBe(true);

      const overlay = await browser.evaluate<string>(
        `document.querySelector('[data-opener-overlay]')?.innerText ?? ''`
      );
      // The repository is named as a chip in the field, and the footer says
      // what leaving it would do.
      expect(overlay).toContain('leave this repository');
      expect(overlay).toContain('Working tree');
      expect(overlay).toContain('BRANCHES');
    } finally {
      // Whatever happened above, the overlay must not be left over the page:
      // every test after this one drives the review underneath it.
      await browser.press('Escape');
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    expect(
      await browser.evaluate<string | null>(
        `document.querySelector('[data-opener-overlay]') ? 'open' : null`
      )
    ).toBeNull();
    // Driving a dialog over CDP is a few dozen round trips; the default five
    // seconds is not enough, and overrunning it kills the page session for
    // every test after this one.
  }, 30_000);

  test('opens the shortcut list on ?', async () => {
    await browser.press('?');
    expect(
      await browser.evaluate<string | null>(
        `document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null`
      )
    ).toBe('Keyboard shortcuts');
    await browser.press('Escape');
  });

  test('marks a file viewed with j then v, and remembers it', async () => {
    await browser.press('j');
    await browser.press('v');
    const stored = await browser.evaluate<string | null>(
      `localStorage.getItem('hunkyard:viewed:' + location.pathname + location.search)`
    );
    expect(stored).toContain('math.ts');

    // Marking viewed collapses the file, so this puts it back: the next test
    // needs a line to select, and a collapsed file has none rendered.
    await browser.press('v');
    expect(
      await browser.evaluate<string | null>(
        `localStorage.getItem('hunkyard:viewed:' + location.pathname + location.search)`
      )
    ).toBeNull();
  });

  test('writes a comment through to the repository', async () => {
    // The gutter is the only place a line selection can start, and it has to be
    // found by position because it lives in shadow DOM.
    const where = await browser.evaluate<{ x: number; y: number } | null>(
      `(() => {
        const cells = [...document.querySelector('diffs-container').shadowRoot
          .querySelectorAll('[data-column-number]')];
        const cell = cells[cells.length - 1];
        if (cell == null) return null;
        const r = cell.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()`
    );
    expect(where).not.toBeNull();

    await browser.drag(where!, where!);
    await browser.press('c');
    expect(
      await browser.evaluate<number>(`document.querySelectorAll('textarea').length`)
    ).toBe(1);

    await browser.evaluate(`document.querySelector('textarea').focus()`);
    for (const key of ['h', 'i']) await browser.press(key);
    expect(
      await browser.evaluate<string>(`document.querySelector('textarea').value`)
    ).toBe('hi');

    await browser.press('Meta+Enter');
    await Bun.sleep(1200);

    const review = await Bun.file(join(repo, '.hunkyard', 'review.md')).text();
    expect(review).toContain('math.ts');
    expect(review).toContain('hi');
  }, 60_000);
});
