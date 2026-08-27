import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '@/lib/git/exec';
import { startServer } from '@/server/index';
import { Browser, chromeAvailable } from './browser';

// The Git status filter menu names each status with a swatch, and the file tree
// paints the same statuses on its rows from the active theme's own decoration
// colours. Whether those two agree cannot be read off the source -- the swatch
// resolves a CSS variable through a portal, the row resolves one inside a shadow
// root -- so it is checked in a browser against a review that has three
// statuses in it at once.
const available = await chromeAvailable();

let base: string;
let repo: string;
let previousState: string | undefined;
let previousRoot: string | undefined;
let server: { port: number; stop(): void };
let browser: Browser;

beforeAll(async () => {
  if (!available) return;

  base = await mkdtemp(join(tmpdir(), 'hunk-status-'));
  repo = join(base, 'repo');
  await Bun.write(join(repo, '.keep'), '');
  await runGit(['init', '-q', '-b', 'main'], { cwd: repo });
  await runGit(['config', 'user.email', 'test@example.com'], { cwd: repo });
  await runGit(['config', 'user.name', 'Test'], { cwd: repo });
  await runGit(['config', 'commit.gpgsign', 'false'], { cwd: repo });
  await writeFile(join(repo, 'keep.ts'), 'export const a = 1;\n');
  await writeFile(join(repo, 'gone.ts'), 'export const b = 2;\n');
  await runGit(['add', '-A'], { cwd: repo });
  await runGit(['commit', '-qm', 'first'], { cwd: repo });

  // One file of each status the menu can offer. The new file is intent-to-add
  // rather than staged, so the working tree diff carries it as added while the
  // other two stay unstaged.
  await writeFile(join(repo, 'keep.ts'), 'export const a = 1;\nexport const c = 3;\n');
  await unlink(join(repo, 'gone.ts'));
  await writeFile(join(repo, 'fresh.ts'), 'export const d = 4;\n');
  await runGit(['add', '-N', 'fresh.ts'], { cwd: repo });

  previousState = process.env.XDG_STATE_HOME;
  previousRoot = process.env.HUNKYARD_REPO_ROOT;
  process.env.XDG_STATE_HOME = join(base, 'state');
  process.env.HUNKYARD_REPO_ROOT = repo;

  server = startServer({ port: 0 });
  const repos = (await (
    await fetch(`http://127.0.0.1:${server.port}/api/repos`)
  ).json()) as { defaultId: string | null };
  if (repos.defaultId == null) throw new Error('the server registered no repository');

  browser = await Browser.launch();
  await browser.open(
    `http://127.0.0.1:${server.port}/local?repo=${encodeURIComponent(repos.defaultId)}`
  );
}, 90_000);

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

// Radix opens the menu on pointerdown, and `element.click()` alone does not
// carry one.
function pointerClick(selector: string): string {
  return `(() => {
    const target = ${selector};
    if (target == null) return 'missing';
    for (const type of ['pointerdown', 'mouseup', 'click']) {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, isPrimary: true,
      }));
    }
    return 'clicked';
  })()`;
}

function menuItem(label: string): string {
  return `[...document.querySelectorAll('[role="menuitemcheckbox"]')].find((el) => el.textContent?.includes(${JSON.stringify(label)}))`;
}

// Every colour the comparison needs, read in one pass: the menu's swatches, the
// status colour of each tree row (the colour most of its glyph is painted in,
// which is whatever the row's own text colour is not), and the theme's own
// modified colour resolved to the same rgb() form the swatches come back as.
const READ_COLOURS = `(() => {
  const item = (label) =>
    [...document.querySelectorAll('[role="menuitemcheckbox"]')]
      .find((el) => el.textContent?.includes(label));
  const swatch = (label) => {
    const span = item(label)?.querySelector('span[style*="--hunkyard-status"]');
    return span ? getComputedStyle(span).color : null;
  };
  const host = document.querySelector('file-tree-container');
  const rowGlyph = (status) => {
    const row = host?.shadowRoot?.querySelector('[data-item-git-status="' + status + '"]');
    if (row == null) return null;
    const rowColor = getComputedStyle(row).color;
    const counts = new Map();
    for (const el of row.querySelectorAll('*')) {
      const colour = getComputedStyle(el).color;
      if (colour === rowColor || colour.includes('/')) continue;
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const asRgb = (value) => {
    if (value === '') return null;
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  };
  return JSON.stringify({
    added: { swatch: swatch('Added'), row: rowGlyph('added') },
    deleted: { swatch: swatch('Deleted'), row: rowGlyph('deleted') },
    modifiedSwatch: swatch('Modified'),
    themeModified: asRgb(
      getComputedStyle(host).getPropertyValue('--trees-theme-git-modified-fg').trim()
    ),
  });
})()`;

interface Colours {
  added: { swatch: string | null; row: string | null };
  deleted: { swatch: string | null; row: string | null };
  modifiedSwatch: string | null;
  themeModified: string | null;
}

describe.skipIf(!available)('the Git status filter menu', () => {
  test('draws each status in the colour its tree rows use', async () => {
    expect(
      await browser.evaluate<string>(
        pointerClick(`document.querySelector('button[aria-label="Filter by Git status"]')`)
      )
    ).toBe('clicked');
    try {
      await Bun.sleep(500);
      const colours = JSON.parse(
        await browser.evaluate<string>(READ_COLOURS)
      ) as Colours;

      for (const status of ['added', 'deleted'] as const) {
        expect(colours[status].swatch).not.toBeNull();
        expect(colours[status].row).not.toBeNull();
        expect(colours[status].swatch).toBe(colours[status].row);
      }
      // A path with no explicit status is treated as modified, so no row
      // carries that attribute to compare against; the theme colour the tree
      // would paint such a row in stands in for it.
      expect(colours.themeModified).not.toBeNull();
      expect(colours.modifiedSwatch).toBe(colours.themeModified);
    } finally {
      await browser.press('Escape');
    }
  }, 60_000);

  test('marks an active filter in the chrome colour, not a fixed blue', async () => {
    expect(
      await browser.evaluate<string>(
        pointerClick(`document.querySelector('button[aria-label="Filter by Git status"]')`)
      )
    ).toBe('clicked');
    try {
      await Bun.sleep(500);
      expect(await browser.evaluate<string>(pointerClick(menuItem('Added')))).toBe(
        'clicked'
      );
    } finally {
      await browser.press('Escape');
    }

    const dot = JSON.parse(
      await browser.evaluate<string>(`(() => {
        const button = document.querySelector('button[aria-label="Filter by Git status"]');
        const marker = button?.querySelector('span.rounded-full');
        return JSON.stringify(
          marker == null
            ? null
            : {
                marker: getComputedStyle(marker).backgroundColor,
                button: getComputedStyle(button).color,
              }
        );
      })()`)
    ) as { marker: string; button: string } | null;

    expect(dot).not.toBeNull();
    expect(dot?.marker).toBe(dot?.button);
  }, 60_000);
});
