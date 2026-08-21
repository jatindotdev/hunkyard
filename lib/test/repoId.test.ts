import { describe, expect, test } from 'bun:test';

import { repoIdFor } from '@/lib/repos/id';

describe('repoIdFor', () => {
  test('is stable for the same path', () => {
    expect(repoIdFor('/Users/x/dev/absolut')).toBe(
      repoIdFor('/Users/x/dev/absolut')
    );
  });

  test('reads as the repository name', () => {
    expect(repoIdFor('/Users/x/dev/absolut')).toStartWith('absolut-');
  });

  // Two checkouts of one project are different repositories to review, so they
  // cannot share an id even though they share a name.
  test('separates two checkouts of the same project', () => {
    expect(repoIdFor('/Users/x/dev/absolut')).not.toBe(
      repoIdFor('/Users/x/work/absolut')
    );
  });

  // The id goes in a URL path segment, so a directory named with spaces or
  // slashes-adjacent characters must not produce something unroutable.
  test('keeps the name safe for a URL', () => {
    expect(repoIdFor('/Users/x/my repo (old)')).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  test('falls back to the hash when nothing of the name survives', () => {
    expect(repoIdFor('/Users/x/###')).toMatch(/^[a-f0-9]{8}$/);
  });
});
