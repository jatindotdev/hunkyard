import { describe, expect, test } from 'bun:test';

import {
  CliError,
  DEFAULT_PORT,
  parseArgs,
  resolveViewerPath,
  viewerUrl,
} from '../cli-core';

describe('parseArgs', () => {
  test('no arguments means the working tree on the default port', () => {
    expect(parseArgs([])).toEqual({
      command: 'review',
      open: true,
      port: DEFAULT_PORT,
      help: false,
      version: false,
      foreground: false,
      target: undefined,
    });
  });

  test('treats --staged, --cached and --all as targets, not unknown flags', () => {
    for (const target of ['--staged', '--cached', '--all']) {
      expect(parseArgs([target]).target).toBe(target);
    }
  });

  test('accepts a port in both spellings', () => {
    expect(parseArgs(['-p', '5000']).port).toBe(5000);
    expect(parseArgs(['--port', '5000']).port).toBe(5000);
    expect(parseArgs(['--port=5000']).port).toBe(5000);
  });

  test('rejects a port that is not a usable number', () => {
    for (const bad of [['-p', 'abc'], ['-p', '0'], ['-p', '70000'], ['--port']]) {
      expect(() => parseArgs(bad)).toThrow(CliError);
    }
  });

  test('a target survives alongside options in any order', () => {
    expect(parseArgs(['--no-open', 'main...x', '-p', '5000'])).toMatchObject({
      open: false,
      port: 5000,
      target: 'main...x',
    });
    expect(parseArgs(['main...x', '--no-open'])).toMatchObject({
      open: false,
      target: 'main...x',
    });
  });

  test('two targets is an error, with a hint about quoting', () => {
    try {
      parseArgs(['main...x', 'HEAD~1']);
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).hint).toContain('quoting');
    }
  });

  test('help and version win over everything else', () => {
    expect(parseArgs(['main...x', '--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });
});

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
    expect(resolveViewerPath('headout/absolut#1527')).toEqual({
      kind: 'github',
      path: '/headout/absolut/pull/1527',
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

describe('commands', () => {
  test('status and stop are commands in the first position', () => {
    expect(parseArgs(['status']).command).toBe('status');
    expect(parseArgs(['stop']).command).toBe('stop');
  });

  // A branch really can be called `stop`, so only the first argument is read as
  // a command; anywhere else it is a revspec like any other.
  test('a target named like a command is still a target', () => {
    expect(parseArgs(['main...stop']).command).toBe('review');
    expect(parseArgs(['main...stop']).target).toBe('main...stop');
    expect(parseArgs(['--no-open', 'stop']).target).toBe('stop');
    expect(parseArgs(['--no-open', 'stop']).command).toBe('review');
  });

  test('--foreground opts out of the background server', () => {
    expect(parseArgs(['--foreground']).foreground).toBe(true);
    expect(parseArgs([]).foreground).toBe(false);
  });
});
