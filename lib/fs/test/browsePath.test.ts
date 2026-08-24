import { describe, expect, test } from 'bun:test';

import { browseCrumbs } from '../browseCrumbs';
import {
  assertBrowsePath,
  InvalidBrowsePathError,
  isWithinRoot,
  parentOf,
} from '../browsePath';

describe('assertBrowsePath', () => {
  test('keeps an absolute path', () => {
    expect(assertBrowsePath('/Users/x/dev')).toBe('/Users/x/dev');
  });

  test('normalises a trailing separator and a dot segment', () => {
    expect(assertBrowsePath('/Users/x/dev/')).toBe('/Users/x/dev');
    expect(assertBrowsePath('/Users/x/./dev')).toBe('/Users/x/dev');
  });

  test('refuses a relative path', () => {
    expect(() => assertBrowsePath('dev')).toThrow(InvalidBrowsePathError);
  });

  // A NUL truncates the string inside the syscall rather than failing, so a
  // path is refused before it reaches one.
  test('refuses a NUL', () => {
    expect(() => assertBrowsePath('/dev\0/null')).toThrow(
      InvalidBrowsePathError
    );
  });
});

describe('isWithinRoot', () => {
  test('lets everything through when there is no root', () => {
    expect(isWithinRoot('/anywhere', null)).toBe(true);
  });

  test('accepts the root itself and what is under it', () => {
    expect(isWithinRoot('/srv/repos', '/srv/repos')).toBe(true);
    expect(isWithinRoot('/srv/repos/a', '/srv/repos')).toBe(true);
  });

  // A bare string prefix would let a sibling directory pass for a child.
  test('refuses a sibling whose name starts with the root', () => {
    expect(isWithinRoot('/srv/repos-private', '/srv/repos')).toBe(false);
    expect(isWithinRoot('/srv', '/srv/repos')).toBe(false);
  });
});

describe('parentOf', () => {
  test('walks up one directory', () => {
    expect(parentOf('/Users/x/dev')).toBe('/Users/x');
  });

  test('stops at the filesystem root', () => {
    expect(parentOf('/')).toBeNull();
  });

  test('stops at the configured root', () => {
    expect(parentOf('/srv/repos', '/srv/repos')).toBeNull();
    expect(parentOf('/srv/repos/a', '/srv/repos')).toBe('/srv/repos');
  });
});

describe('browseCrumbs', () => {
  test('names every step down to the directory', () => {
    expect(browseCrumbs('/Users/x/dev')).toEqual([
      { name: '/', path: '/' },
      { name: 'Users', path: '/Users' },
      { name: 'x', path: '/Users/x' },
      { name: 'dev', path: '/Users/x/dev' },
    ]);
  });

  test('is just the root at the root', () => {
    expect(browseCrumbs('/')).toEqual([{ name: '/', path: '/' }]);
  });

  test('handles a windows path', () => {
    expect(browseCrumbs('C:\\Users\\x')).toEqual([
      { name: 'C:\\', path: 'C:\\' },
      { name: 'Users', path: 'C:\\Users' },
      { name: 'x', path: 'C:\\Users\\x' },
    ]);
  });
});
