import { describe, expect, test } from 'bun:test';

import type { RepositorySurvey, WorktreeStatus } from '@/lib/git/survey';
import {
  buildCompareSpec,
  groupRefsForPicker,
  likelyBaseRef,
  suggestReviewTargets,
  validateRevspecInput,
} from '@/lib/local/repoSurvey';

function ref(name: string, isHead = false) {
  return { name, oid: 'a', date: null, subject: '', upstream: null, isHead };
}

function survey(overrides: Partial<RepositorySurvey> = {}): RepositorySurvey {
  return {
    branches: [],
    remoteBranches: [],
    tags: [],
    defaultBranch: null,
    status: null,
    commits: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    ...overrides,
  };
}

function status(overrides: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    branch: 'main',
    detached: false,
    oid: 'abc',
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    ...overrides,
  };
}

describe('likelyBaseRef', () => {
  test('prefers the branch its own upstream', () => {
    expect(
      likelyBaseRef(
        survey({
          status: status({ branch: 'feature', upstream: 'origin/feature' }),
          defaultBranch: 'main',
          remoteBranches: [ref('origin/main')],
        })
      )
    ).toBe('origin/feature');
  });

  test('falls back to the remote default branch', () => {
    expect(
      likelyBaseRef(
        survey({
          status: status({ branch: 'feature' }),
          defaultBranch: 'main',
          remoteBranches: [ref('origin/main')],
        })
      )
    ).toBe('origin/main');
  });

  test('then to a local branch of that name', () => {
    expect(
      likelyBaseRef(
        survey({
          status: status({ branch: 'feature' }),
          defaultBranch: 'main',
          branches: [ref('main'), ref('feature', true)],
        })
      )
    ).toBe('main');
  });

  // Standing on the default branch, comparing it with itself is an empty diff.
  test('never suggests the branch you are on', () => {
    expect(
      likelyBaseRef(
        survey({
          status: status({ branch: 'main' }),
          defaultBranch: 'main',
          branches: [ref('main', true)],
          commits: [],
        })
      )
    ).toBeNull();
  });

  test('offers the previous commit when there is no remote at all', () => {
    expect(
      likelyBaseRef(
        survey({
          status: status({ branch: 'main' }),
          commits: [
            { oid: 'b', shortOid: 'b', date: '', author: '', subject: '' },
            { oid: 'a', shortOid: 'a', date: '', author: '', subject: '' },
          ],
        })
      )
    ).toBe('HEAD~1');
  });

  test('has nothing to offer in a repository with one commit', () => {
    expect(
      likelyBaseRef(
        survey({
          status: status(),
          commits: [
            { oid: 'a', shortOid: 'a', date: '', author: '', subject: '' },
          ],
        })
      )
    ).toBeNull();
  });
});

describe('buildCompareSpec', () => {
  // Three-dot is git's merge-base form, which is what a pull request is
  // anchored against, so the line numbers agree with the eventual review.
  test('is three-dot by default', () => {
    expect(buildCompareSpec('main', 'feature')).toBe('main...feature');
  });

  test('can be a direct comparison instead', () => {
    expect(buildCompareSpec('main', 'feature', { merged: false })).toBe(
      'main..feature'
    );
  });
});

describe('suggestReviewTargets', () => {
  test('offers the three uncommitted views before the survey lands', () => {
    const targets = suggestReviewTargets(survey());
    expect(targets.map((target) => target.spec)).toEqual([
      undefined,
      '--staged',
      '--all',
    ]);
    // Counts are unknown, not zero: a row saying "0 files" before status has
    // answered is wrong rather than merely empty.
    expect(targets.every((target) => target.count === null)).toBe(true);
  });

  test('counts each uncommitted view separately', () => {
    const targets = suggestReviewTargets(
      survey({ status: status({ staged: 2, unstaged: 3, untracked: 1 }) })
    );
    expect(targets.map((target) => target.count)).toEqual([4, 2, 6]);
  });

  test('adds this branch against its base', () => {
    const targets = suggestReviewTargets(
      survey({
        status: status({ branch: 'feature' }),
        defaultBranch: 'main',
        remoteBranches: [ref('origin/main')],
      })
    );
    expect(targets.at(-1)).toMatchObject({
      kind: 'range',
      spec: 'origin/main...feature',
    });
  });

  test('leaves the comparison out on a detached HEAD', () => {
    const targets = suggestReviewTargets(
      survey({
        status: status({ branch: null, detached: true }),
        defaultBranch: 'main',
        remoteBranches: [ref('origin/main')],
      })
    );
    expect(targets.some((target) => target.kind === 'range')).toBe(false);
  });
});

describe('groupRefsForPicker', () => {
  test('puts the checked-out branch first and drops empty groups', () => {
    const groups = groupRefsForPicker(
      survey({
        branches: [ref('main'), ref('feature', true)],
        tags: [ref('v1.0.0')],
      })
    );
    expect(groups.map((group) => group.label)).toEqual(['Branches', 'Tags']);
    expect(groups[0]?.refs[0]?.name).toBe('feature');
  });
});

describe('validateRevspecInput', () => {
  test('accepts anything that could be a revspec', () => {
    expect(validateRevspecInput(' main...feature ')).toEqual({
      valid: true,
      spec: 'main...feature',
    });
    expect(validateRevspecInput('--staged')).toEqual({
      valid: true,
      spec: '--staged',
    });
  });

  test('refuses nothing at all', () => {
    expect(validateRevspecInput('  ')).toMatchObject({ valid: false });
  });

  // A leading dash is read as an option by whatever it reaches.
  test('refuses an unknown dashed spec', () => {
    expect(validateRevspecInput('--exec=rm')).toMatchObject({ valid: false });
  });
});
