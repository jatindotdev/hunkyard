import type { RefSummary, RepositorySurvey } from '../git/survey';
import type { GitTargetKind } from '../git/targets';

// What the picker offers, derived from a survey. Pure, so the ordering rules
// can be tested without a browser and without a repository -- and so the header
// menu and the picker page cannot drift apart, since both call this.

export interface ReviewTarget {
  kind: GitTargetKind;
  // The spec the local diff route takes, which is what goes in the URL.
  // Undefined is the working tree, matching the CLI's own default.
  spec: string | undefined;
  title: string;
  detail: string;
  // How many files this would show, or null when the survey has not answered
  // yet -- the list paints before the working-tree counts arrive.
  count: number | null;
}

const UNCOMMITTED_DETAIL = {
  worktree: 'changes you have not staged',
  staged: 'the index against HEAD',
  all: 'staged, unstaged and untracked together',
} as const;

// The base this branch is most likely to be reviewed against.
//
// Its own upstream while the branch is ahead of it: that is the narrowest true
// statement of what the branch adds. Once everything is pushed the upstream has
// nothing left to say -- the spec is a merge-base range, so a branch level with
// its upstream, or behind it, compares empty -- and what is worth reading is the
// branch against the default branch, which is what its eventual pull request is
// anchored to anyway. Then a local branch of that name. A branch that was never
// pushed still has its own history to sit against.
export function likelyBaseRef(survey: RepositorySurvey): string | null {
  const status = survey.status;
  const branch = status?.branch ?? null;
  const upstream = status?.upstream ?? null;
  if (upstream != null && upstream !== branch && (status?.ahead ?? 0) > 0) {
    return upstream;
  }

  const known = new Set(
    [...survey.branches, ...survey.remoteBranches].map((ref) => ref.name)
  );
  for (const candidate of survey.defaultBranch == null
    ? []
    : [`origin/${survey.defaultBranch}`, survey.defaultBranch]) {
    // Two ways to name an empty diff: the branch against itself, and the branch
    // against an upstream it has nothing on top of.
    if (candidate === branch || candidate === upstream) continue;
    if (known.has(candidate)) return candidate;
  }

  // A branch that tracks nothing has no base anywhere but its own history. One
  // that is fully pushed with no default branch to sit under has none at all,
  // and its previous commit is not what "this branch" means.
  if (upstream != null) return null;
  return survey.commits.length > 1 ? 'HEAD~1' : null;
}

// Three dots, not two: it is git's merge-base form, which is what GitHub
// anchors a pull request against, so a branch reviewed here and the eventual
// pull request agree on line numbers.
export function buildCompareSpec(
  base: string,
  head: string,
  options: { merged?: boolean } = {}
): string {
  return `${base}${options.merged === false ? '..' : '...'}${head}`;
}

export function suggestReviewTargets(
  survey: RepositorySurvey
): ReviewTarget[] {
  const status = survey.status;
  const targets: ReviewTarget[] = [
    {
      kind: 'worktree',
      spec: undefined,
      title: 'Working tree',
      detail: UNCOMMITTED_DETAIL.worktree,
      count: status == null ? null : status.unstaged + status.untracked,
    },
    {
      kind: 'staged',
      spec: '--staged',
      title: 'Staged changes',
      detail: UNCOMMITTED_DETAIL.staged,
      count: status?.staged ?? null,
    },
    {
      kind: 'all',
      spec: '--all',
      title: 'All uncommitted changes',
      detail: UNCOMMITTED_DETAIL.all,
      count:
        status == null
          ? null
          : status.staged + status.unstaged + status.untracked,
    },
  ];

  const base = likelyBaseRef(survey);
  const head = survey.status?.branch;
  if (base != null && head != null) {
    const spec = buildCompareSpec(base, head);
    targets.push({
      kind: 'range',
      spec,
      title: spec,
      detail: 'this branch against the commit it grew from',
      count: null,
    });
  }

  return targets;
}

export interface RefGroup {
  label: string;
  refs: RefSummary[];
}

// The ref lists as the picker shows them: the branch you are on first, since it
// is the one you are most likely to compare against, then everything else in
// the order git gave, which is most recently committed first.
export function groupRefsForPicker(survey: RepositorySurvey): RefGroup[] {
  const branches = [...survey.branches].sort((a, b) =>
    a.isHead === b.isHead ? 0 : a.isHead ? -1 : 1
  );
  return [
    { label: 'Branches', refs: branches },
    { label: 'Remote branches', refs: survey.remoteBranches },
    { label: 'Tags', refs: survey.tags },
  ].filter((group) => group.refs.length > 0);
}

export type RevspecValidation =
  | { valid: true; spec: string }
  | { valid: false; message: string };

// The escape hatch takes anything git understands, so this refuses only what
// cannot be a revspec at all rather than trying to parse one.
export function validateRevspecInput(input: string): RevspecValidation {
  const spec = input.trim();
  if (spec === '') {
    return { valid: false, message: 'Enter a revision, a range or a commit.' };
  }
  if (spec.includes('\0')) {
    return { valid: false, message: 'A revision cannot contain a NUL byte.' };
  }
  // A leading dash would be read as an option by whatever it is passed to, and
  // the two that are meaningful here are spelled out rather than typed.
  if (spec.startsWith('-') && spec !== '--staged' && spec !== '--all') {
    return {
      valid: false,
      message: 'A revision cannot start with a dash. Use --staged or --all.',
    };
  }
  return { valid: true, spec };
}
