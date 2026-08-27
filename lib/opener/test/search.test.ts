import { describe, expect, test } from 'bun:test';

import {
  baseName,
  classifyQuery,
  matchScore,
  rankBy,
  shortenPath,
  splitPathQuery,
} from '@/lib/opener/search';

const HOME = '/Users/jatin';

describe('classifyQuery', () => {
  test('nothing typed is nothing meant', () => {
    expect(classifyQuery('', HOME)).toEqual({ kind: 'empty' });
    expect(classifyQuery('   ', HOME)).toEqual({ kind: 'empty' });
  });

  test('an absolute path is a path', () => {
    expect(classifyQuery('/Users/jatin/dev', HOME)).toEqual({
      kind: 'path',
      path: '/Users/jatin/dev',
    });
  });

  // Typed by hand far more often than the expanded form.
  test('expands a leading tilde', () => {
    expect(classifyQuery('~/dev', HOME)).toEqual({
      kind: 'path',
      path: '/Users/jatin/dev',
    });
    expect(classifyQuery('~', HOME)).toEqual({ kind: 'path', path: HOME });
  });

  test('a tilde with nowhere to expand to is just text', () => {
    expect(classifyQuery('~/dev', null)).toEqual({ kind: 'text', text: '~/dev' });
  });

  test('a pull request is a pull request', () => {
    expect(classifyQuery('owner/repo#123', HOME)).toEqual({
      kind: 'github',
      href: '/owner/repo/pull/123',
    });
    expect(
      classifyQuery('https://github.com/oven-sh/bun/pull/1', HOME)
    ).toMatchObject({ kind: 'github' });
  });

  // A host with no way to fetch a patch from it is not a forge result, and
  // falling through to text is better than offering something that 404s.
  test('a host we cannot fetch from is text', () => {
    expect(
      classifyQuery('https://gitlab.com/a/b/-/merge_requests/1', HOME)
    ).toMatchObject({ kind: 'text' });
  });

  test('anything else is text', () => {
    expect(classifyQuery('hunkyard', HOME)).toEqual({
      kind: 'text',
      text: 'hunkyard',
    });
  });
});

describe('splitPathQuery', () => {
  // Results narrow as you type rather than waiting for a directory that does
  // not exist yet.
  test('lists the parent and filters by what is half-typed', () => {
    expect(splitPathQuery('/Users/ja')).toEqual({
      dir: '/Users',
      filter: 'ja',
    });
  });

  test('a trailing slash lists that directory whole', () => {
    expect(splitPathQuery('/Users/jatin/')).toEqual({
      dir: '/Users/jatin',
      filter: '',
    });
  });

  test('handles the root', () => {
    expect(splitPathQuery('/')).toEqual({ dir: '/', filter: '' });
    expect(splitPathQuery('/Us')).toEqual({ dir: '/', filter: 'Us' });
  });
});

describe('matchScore', () => {
  test('an exact match beats everything', () => {
    expect(matchScore('hunk', 'hunk')).toBeGreaterThan(
      matchScore('hunkyard', 'hunk') as number
    );
  });

  test('a prefix beats a scattered match', () => {
    expect(matchScore('hunkyard', 'hunk')).toBeGreaterThan(
      matchScore('has-under-no-key', 'hunk') as number
    );
  });

  test('adjacent characters beat scattered ones', () => {
    expect(matchScore('abcdef', 'abc')).toBeGreaterThan(
      matchScore('axbxcx', 'abc') as number
    );
  });

  // A match after a separator is a word boundary, which is what people mean
  // when they type initials.
  test('rewards matches at boundaries', () => {
    expect(matchScore('partner-docs', 'pd')).toBeGreaterThan(
      matchScore('paddle', 'pd') as number
    );
  });

  test('is null when the characters are not there in order', () => {
    expect(matchScore('hunkyard', 'xyz')).toBeNull();
    expect(matchScore('hunkyard', 'khun')).toBeNull();
  });

  test('an empty query matches anything', () => {
    expect(matchScore('anything', '')).toBe(0);
  });
});

describe('rankBy', () => {
  const repos = ['hunkyard', 'absolut', 'apollo', 'partner-docs'];

  // The ones starting with the query come first, shortest of those first,
  // and anything merely containing it comes after.
  test('puts prefix matches ahead of incidental ones', () => {
    expect(rankBy(repos, 'a', (name) => name).slice(0, 2)).toEqual([
      'apollo',
      'absolut',
    ]);
  });

  test('orders a real name above a scattered match', () => {
    expect(rankBy(repos, 'part', (name) => name)[0]).toBe('partner-docs');
  });

  test('drops what does not match at all', () => {
    expect(rankBy(repos, 'hunk', (name) => name)).toEqual(['hunkyard']);
  });

  test('an empty query keeps the order it was given', () => {
    expect(rankBy(repos, '', (name) => name)).toEqual(repos);
  });

  test('honours the limit', () => {
    expect(rankBy(repos, '', (name) => name, 2)).toHaveLength(2);
  });
});

describe('paths for reading', () => {
  test('baseName is the last segment', () => {
    expect(baseName('/Users/jatin/dev/hunkyard')).toBe('hunkyard');
    expect(baseName('/Users/jatin/dev/hunkyard/')).toBe('hunkyard');
    expect(baseName('/')).toBe('');
  });

  test('shortenPath puts the tilde back', () => {
    expect(shortenPath('/Users/jatin/dev', HOME)).toBe('~/dev');
    expect(shortenPath(HOME, HOME)).toBe('~');
    expect(shortenPath('/etc', HOME)).toBe('/etc');
    expect(shortenPath('/Users/jatinx/dev', HOME)).toBe('/Users/jatinx/dev');
  });
});
