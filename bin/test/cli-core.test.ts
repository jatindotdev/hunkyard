import { describe, expect, test } from 'bun:test';

import {
  CliError,
  DEFAULT_PORT,
  isCompiledBinary,
  resolveReviewOrigin,
  resolveViewerPath,
  selfCommand,
} from '../cli-core';

describe('resolveViewerPath', () => {
  test('no target is the working tree', () => {
    expect(resolveViewerPath(undefined)).toEqual({
      kind: 'local',
      path: '/local',
    });
  });

  test('revspecs stay local and are encoded', () => {
    expect(resolveViewerPath('main...feature')).toEqual({
      kind: 'local',
      path: '/local/main...feature',
    });
    // A slash in a ref name must not become a path separator.
    expect(resolveViewerPath('origin/main...feature/x').path).toBe(
      '/local/origin%2Fmain...feature%2Fx'
    );
    expect(resolveViewerPath('--staged').path).toBe('/local/--staged');
  });

  test('owner/repo#N is a pull request', () => {
    expect(resolveViewerPath('facebook/react#28000')).toEqual({
      kind: 'github',
      path: '/facebook/react/pull/28000',
    });
  });

  test('a bare owner/repo stays a local revspec', () => {
    // `feature/login` is a far likelier branch than a repository, so the
    // conservative reading is deliberate.
    expect(resolveViewerPath('feature/login').kind).toBe('local');
  });

  test('github URLs are accepted and normalised', () => {
    expect(resolveViewerPath('https://github.com/a/b/pull/9').path).toBe(
      '/a/b/pull/9'
    );
    expect(resolveViewerPath('https://github.com/a/b/pull/9/').path).toBe(
      '/a/b/pull/9'
    );
    expect(resolveViewerPath('https://github.com/a/b/commit/abc123').kind).toBe(
      'github'
    );
  });

  test('a non-github URL is refused with a usable hint', () => {
    try {
      resolveViewerPath('https://gitlab.com/a/b/-/merge_requests/1');
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain('gitlab.com');
      expect((error as CliError).hint).toContain('revspec');
    }
  });
});

describe('isCompiledBinary', () => {
  // `--bytecode`, which the release build uses, makes import.meta.path the
  // original source path, so a check against it answers "not compiled" for
  // exactly the binary that ships. argv[1] stays the bunfs path.
  test('reads argv rather than the module path', () => {
    expect(isCompiledBinary(['bun', '/$bunfs/root/hunk', 'status'])).toBe(true);
    expect(
      isCompiledBinary(['bun', '/Users/x/hunkyard/bin/hunk.ts', 'status'])
    ).toBe(false);
  });
});

describe('selfCommand', () => {
  test('a compiled binary re-runs itself with no script argument', () => {
    expect(
      selfCommand('/src/bin/hunk.ts', ['bun', '/$bunfs/root/hunk'], '/usr/bin/hunk')
    ).toEqual(['/usr/bin/hunk']);
  });

  // From a checkout execPath is bun itself, so the entry has to be named or the
  // child re-runs bun with nothing to run.
  test('a checkout names the entry', () => {
    expect(
      selfCommand('/src/bin/hunk.ts', ['bun', '/src/bin/hunk.ts'], '/usr/bin/bun')
    ).toEqual(['/usr/bin/bun', '/src/bin/hunk.ts']);
  });
});

describe('resolveReviewOrigin', () => {
  test('is the bare host once the forwarder answers', () => {
    expect(
      resolveReviewOrigin({ port: DEFAULT_PORT, bareReachable: true })
    ).toEqual({ kind: 'origin', origin: 'http://hunkyard.localhost' });
  });

  // Handing back the ported URL instead would be a second origin, and browser
  // storage is per-origin: viewed state would depend on which one you opened.
  test('asks for an install rather than falling back to the port', () => {
    expect(
      resolveReviewOrigin({ port: DEFAULT_PORT, bareReachable: false })
    ).toEqual({ kind: 'needs-install' });
  });

  // The forwarder points at one port, so asking for another is asking not to be
  // behind it. Refusing here would make --port useless.
  test('a port chosen by hand is served on that port', () => {
    expect(resolveReviewOrigin({ port: 5000, bareReachable: false })).toEqual({
      kind: 'origin',
      origin: 'http://hunkyard.localhost:5000',
    });
    expect(resolveReviewOrigin({ port: 5000, bareReachable: true })).toEqual({
      kind: 'origin',
      origin: 'http://hunkyard.localhost:5000',
    });
  });
});

describe('resolveReviewOrigin where nothing can be registered', () => {
  // Windows has no privileged-port concept and no socket handoff, so `hunk
  // install` has nothing to do there. Asking for one anyway was a loop: hunk
  // said to install, install said there was nothing to install.
  test('hands over the ported URL rather than asking for an install', () => {
    expect(
      resolveReviewOrigin({
        port: DEFAULT_PORT,
        bareReachable: false,
        canRegister: false,
      })
    ).toEqual({ kind: 'origin', origin: 'http://hunkyard.localhost:4865' });
  });

  // The one-origin rule is about two origins splitting browser storage; where
  // only one is possible there is nothing to split.
  test('is still one origin, just a different one', () => {
    const withPort = resolveReviewOrigin({
      port: DEFAULT_PORT,
      bareReachable: true,
      canRegister: false,
    });
    expect(withPort).toEqual({
      kind: 'origin',
      origin: 'http://hunkyard.localhost:4865',
    });
  });
});
