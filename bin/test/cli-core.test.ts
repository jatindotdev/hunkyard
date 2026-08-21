import { describe, expect, test } from 'bun:test';

import { CliError, resolveViewerPath, viewerUrl } from '../cli-core';

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

describe('viewerUrl', () => {
  test('uses the stable hostname so localStorage survives restarts', () => {
    expect(viewerUrl(4865, '/local')).toBe(
      'http://hunkyard.localhost:4865/local'
    );
  });
});
