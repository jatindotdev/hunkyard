import { describe, expect, test } from 'bun:test';

import { repoIdFor } from '@/lib/repos/id';
import { pruneMissingRepos } from '@/lib/repos/registry';

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

describe('pruneMissingRepos', () => {
  test('keeps a repository that is still there', () => {
    const repos = [{ id: 'a', root: process.cwd(), lastUsedAt: 'now' }];
    expect(pruneMissingRepos(repos)).toEqual(repos);
  });

  // A temp directory from a test run lingers in `hunk status` forever
  // otherwise, which is how this was noticed.
  test('drops one whose directory is gone', () => {
    expect(
      pruneMissingRepos([
        { id: 'gone', root: '/no/such/place/at/all', lastUsedAt: 'now' },
        { id: 'here', root: process.cwd(), lastUsedAt: 'now' },
      ]).map((repo) => repo.id)
    ).toEqual(['here']);
  });
});
