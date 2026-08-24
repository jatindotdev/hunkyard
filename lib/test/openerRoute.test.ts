import { describe, expect, test } from 'bun:test';

import {
  encodeOpenerHref,
  isAbsoluteBrowsePath,
  resolveOpenerRoute,
} from '@/lib/openerRoute';

describe('resolveOpenerRoute', () => {
  test('is the chooser with nothing in the query', () => {
    expect(resolveOpenerRoute('')).toEqual({ kind: 'chooser' });
    expect(resolveOpenerRoute('?')).toEqual({ kind: 'chooser' });
  });

  test('reads a directory to browse', () => {
    expect(resolveOpenerRoute('?path=%2FUsers%2Fx%2Fdev')).toEqual({
      kind: 'browse',
      path: '/Users/x/dev',
    });
  });

  test('reads a repository to pick a target in', () => {
    expect(resolveOpenerRoute('?repo=absolut-1234abcd')).toEqual({
      kind: 'targets',
      repoId: 'absolut-1234abcd',
    });
  });

  // Committing a repository navigates from the browser to the picker, so both
  // can be present for one render; the repository is the newer intent.
  test('prefers a repository over a directory', () => {
    expect(resolveOpenerRoute('?path=%2FUsers%2Fx&repo=x-1234abcd')).toEqual({
      kind: 'targets',
      repoId: 'x-1234abcd',
    });
  });

  // A relative path would be resolved against the server's own directory, so
  // it never reaches a fetch.
  test('falls back to the chooser for a path that is not absolute', () => {
    expect(resolveOpenerRoute('?path=dev%2Fhunkyard')).toEqual({
      kind: 'chooser',
    });
    expect(resolveOpenerRoute('?path=')).toEqual({ kind: 'chooser' });
  });

  test('ignores an empty repository id', () => {
    expect(resolveOpenerRoute('?repo=%20')).toEqual({ kind: 'chooser' });
  });

  test('works on a search string without its question mark', () => {
    expect(resolveOpenerRoute('repo=x-1234abcd')).toEqual({
      kind: 'targets',
      repoId: 'x-1234abcd',
    });
  });
});

describe('isAbsoluteBrowsePath', () => {
  test('accepts a posix path', () => {
    expect(isAbsoluteBrowsePath('/')).toBe(true);
    expect(isAbsoluteBrowsePath('/Users/x')).toBe(true);
  });

  test('refuses a relative path or an embedded NUL', () => {
    expect(isAbsoluteBrowsePath('dev')).toBe(false);
    expect(isAbsoluteBrowsePath('C:\\Users\\x')).toBe(false);
    expect(isAbsoluteBrowsePath('')).toBe(false);
    expect(isAbsoluteBrowsePath('/Users/x\0/etc')).toBe(false);
  });
});

describe('encodeOpenerHref', () => {
  test('round-trips each route', () => {
    for (const route of [
      { kind: 'chooser' } as const,
      { kind: 'browse', path: '/Users/x/my repo' } as const,
      { kind: 'targets', repoId: 'x-1234abcd' } as const,
    ]) {
      const href = encodeOpenerHref(route);
      expect(resolveOpenerRoute(href.slice(href.indexOf('?')))).toEqual(route);
    }
  });

  test('encodes a path that needs it', () => {
    expect(encodeOpenerHref({ kind: 'browse', path: '/a b/c&d' })).toBe(
      '/?path=%2Fa%20b%2Fc%26d'
    );
  });
});
