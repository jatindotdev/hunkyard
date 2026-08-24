import { isGitSuccess, runGit } from './exec';

// What a repository offers to review, gathered in one request so the picker can
// paint itself without a round trip per section.

export interface RefSummary {
  name: string;
  oid: string;
  // An annotated tag has no committerdate, so a date can genuinely be missing.
  date: string | null;
  subject: string;
  upstream: string | null;
  isHead: boolean;
}

export interface CommitSummary {
  oid: string;
  shortOid: string;
  date: string;
  author: string;
  subject: string;
}

export interface WorktreeStatus {
  // The branch HEAD is on, or null when it is detached.
  branch: string | null;
  detached: boolean;
  // Null in a repository with no commits yet.
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface RepositorySurvey {
  branches: RefSummary[];
  remoteBranches: RefSummary[];
  tags: RefSummary[];
  // The branch `origin/HEAD` points at, without its remote prefix. Null when
  // the remote's default was never fetched, which is the case for a repository
  // that was `git init`ed rather than cloned.
  defaultBranch: string | null;
  status: WorktreeStatus | null;
  commits: CommitSummary[];
  truncated: { branches: boolean; remoteBranches: boolean; tags: boolean };
}

export type SurveyPart = 'refs' | 'status' | 'commits';

export const ALL_SURVEY_PARTS: readonly SurveyPart[] = [
  'refs',
  'status',
  'commits',
];

export function parseSurveyParts(raw: string | null): readonly SurveyPart[] {
  if (raw == null || raw.trim() === '') return ALL_SURVEY_PARTS;
  const wanted = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is SurveyPart =>
      ALL_SURVEY_PARTS.includes(part as SurveyPart)
    );
  return wanted.length === 0 ? ALL_SURVEY_PARTS : wanted;
}

// A picker shows what you might plausibly pick, and nobody picks the
// two-thousandth stale branch. One more than the cap is asked for so a
// truncated list can say that it is one.
const REF_LIMIT = 200;
const TAG_LIMIT = 100;
const COMMIT_LIMIT = 50;

// `%1f` in a for-each-ref format emits a real 0x1F, so fields need no quoting
// scheme and a subject containing anything at all still splits correctly.
const UNIT = '\u001f';

const REF_FORMAT = [
  '%(objectname)',
  '%(refname:short)',
  '%(committerdate:iso-strict)',
  '%(contents:subject)',
  '%(upstream:short)',
  '%(HEAD)',
  '%(symref:short)',
].join('%1f');

// An annotated tag's own object has no committerdate and no useful subject; the
// commit it points at has both, and `*` peels to it. A lightweight tag has no
// peeled object, so its unpeeled fields are the answer instead.
const TAG_FORMAT = [
  '%(objectname)',
  '%(*objectname)',
  '%(refname:short)',
  '%(creatordate:iso-strict)',
  '%(contents:subject)',
  '%(*subject)',
].join('%1f');

const COMMIT_FORMAT = ['%H', '%h', '%cI', '%an', '%s'].join('%x1f');

function splitLines(raw: string): string[] {
  return raw.split('\n').filter((line) => line !== '');
}

function emptyToNull(value: string | undefined): string | null {
  return value == null || value === '' ? null : value;
}

interface ParsedRefs {
  refs: RefSummary[];
  truncated: boolean;
  // A remote's HEAD points at its default branch rather than being a branch of
  // its own, so it is reported separately and kept out of the list.
  symrefTargets: Map<string, string>;
}

export function parseRefLines(raw: string, limit: number): ParsedRefs {
  const lines = splitLines(raw);
  const truncated = lines.length > limit;
  const refs: RefSummary[] = [];
  const symrefTargets = new Map<string, string>();

  for (const line of lines.slice(0, limit)) {
    const [oid, name, date, subject, upstream, head, symref] = line.split(UNIT);
    if (name == null || name === '') continue;
    if (symref != null && symref !== '') {
      symrefTargets.set(name, symref);
      continue;
    }
    refs.push({
      oid: oid ?? '',
      name,
      date: emptyToNull(date),
      subject: subject ?? '',
      upstream: emptyToNull(upstream),
      isHead: head === '*',
    });
  }

  return { refs, truncated, symrefTargets };
}

export function parseTagLines(raw: string, limit: number): ParsedRefs {
  const lines = splitLines(raw);
  const truncated = lines.length > limit;
  const refs: RefSummary[] = [];

  for (const line of lines.slice(0, limit)) {
    const [oid, peeled, name, date, subject, peeledSubject] = line.split(UNIT);
    if (name == null || name === '') continue;
    refs.push({
      oid: emptyToNull(peeled) ?? oid ?? '',
      name,
      date: emptyToNull(date),
      subject: emptyToNull(peeledSubject) ?? subject ?? '',
      upstream: null,
      isHead: false,
    });
  }

  return { refs, truncated, symrefTargets: new Map() };
}

function countFrom(value: string | undefined): number {
  const parsed = Number.parseInt(value?.replace(/^[+-]/, '') ?? '', 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// `git status --porcelain=v2 --branch` answers what four separate calls used
// to: the object id, the branch, its upstream and how far apart they are. It
// also says `(detached)` outright, rather than leaving `HEAD` to mean both a
// detached head and a branch literally named HEAD.
export function parseStatus(raw: string): WorktreeStatus {
  const status: WorktreeStatus = {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  const records = raw.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record == null || record === '') continue;

    if (record.startsWith('# branch.oid ')) {
      const oid = record.slice('# branch.oid '.length);
      status.oid = oid === '(initial)' ? null : oid;
      continue;
    }
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length);
      status.detached = head === '(detached)';
      status.branch = status.detached ? null : head;
      continue;
    }
    if (record.startsWith('# branch.upstream ')) {
      status.upstream = record.slice('# branch.upstream '.length);
      continue;
    }
    if (record.startsWith('# branch.ab ')) {
      const [ahead, behind] = record.slice('# branch.ab '.length).split(' ');
      status.ahead = countFrom(ahead);
      status.behind = countFrom(behind);
      continue;
    }
    if (record.startsWith('#')) continue;

    if (record.startsWith('? ')) {
      status.untracked += 1;
      continue;
    }
    if (record.startsWith('u ')) {
      status.conflicted += 1;
      continue;
    }
    if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const xy = record.slice(2, 4);
      if (xy[0] !== '.') status.staged += 1;
      if (xy[1] !== '.') status.unstaged += 1;
      // A rename record carries its original path as a second NUL-terminated
      // field, which would otherwise be read as a record of its own.
      if (record.startsWith('2 ')) index += 1;
    }
  }

  return status;
}

export function parseCommitLines(raw: string): CommitSummary[] {
  return splitLines(raw).map((line) => {
    const [oid, shortOid, date, author, subject] = line.split(UNIT);
    return {
      oid: oid ?? '',
      shortOid: shortOid ?? '',
      date: date ?? '',
      author: author ?? '',
      subject: subject ?? '',
    };
  });
}

async function gitText(args: readonly string[], cwd: string): Promise<string> {
  const result = await runGit(args, { cwd });
  // An unborn HEAD makes `log` exit 128, and a repository with no remote simply
  // has no remote refs. Either way an empty section is the honest answer, and a
  // picker that renders nothing beats one that renders an error.
  if (!isGitSuccess(result.code)) return '';
  return result.stdout.toString('utf8');
}

function refArgs(
  namespace: string,
  limit: number,
  sort: string,
  format: string
): string[] {
  return [
    'for-each-ref',
    `--sort=${sort}`,
    // One more than the cap, so a full list can be told from a cut one.
    `--count=${limit + 1}`,
    `--format=${format}`,
    namespace,
  ];
}

// `origin/main` names a branch called `main`. The remote prefix is dropped so
// the name can be compared against a local branch of the same name.
function stripRemote(ref: string): string {
  const slash = ref.indexOf('/');
  return slash === -1 ? ref : ref.slice(slash + 1);
}

export interface SurveyOptions {
  parts?: readonly SurveyPart[];
}

// Every call is bounded and none depends on another, so they run at once.
// Three separate ref calls rather than one: `--count` applies to the whole
// sort, so a repository with thousands of stale remote branches would otherwise
// return no local branches at all.
export async function surveyRepository(
  root: string,
  options: SurveyOptions = {}
): Promise<RepositorySurvey> {
  const parts = new Set(options.parts ?? ALL_SURVEY_PARTS);
  const wantRefs = parts.has('refs');

  const [heads, remotes, tags, statusText, commits] = await Promise.all([
    wantRefs
      ? gitText(
          refArgs('refs/heads', REF_LIMIT, '-committerdate', REF_FORMAT),
          root
        )
      : '',
    wantRefs
      ? gitText(
          refArgs('refs/remotes', REF_LIMIT, '-committerdate', REF_FORMAT),
          root
        )
      : '',
    wantRefs
      ? gitText(
          refArgs('refs/tags', TAG_LIMIT, '-creatordate', TAG_FORMAT),
          root
        )
      : '',
    parts.has('status')
      ? gitText(
          [
            'status',
            '--porcelain=v2',
            '--branch',
            // Normal, not `all`: an untracked directory of a hundred thousand
            // files collapses to one record instead of a hundred thousand.
            '--untracked-files=normal',
            '-z',
          ],
          root
        )
      : '',
    parts.has('commits')
      ? gitText(
          ['log', `--max-count=${COMMIT_LIMIT}`, `--pretty=format:${COMMIT_FORMAT}`],
          root
        )
      : '',
  ]);

  const localRefs = parseRefLines(heads, REF_LIMIT);
  const remoteRefs = parseRefLines(remotes, REF_LIMIT);
  const tagRefs = parseTagLines(tags, TAG_LIMIT);

  // `refs/remotes/origin/HEAD` shortens to `origin`, and `%(symref:short)` on
  // that row is `origin/main`, so the default branch costs no extra spawn.
  const defaultTarget =
    remoteRefs.symrefTargets.get('origin') ??
    remoteRefs.symrefTargets.values().next().value;
  const defaultBranch =
    defaultTarget == null ? null : stripRemote(defaultTarget);

  return {
    branches: localRefs.refs,
    remoteBranches: remoteRefs.refs,
    tags: tagRefs.refs,
    defaultBranch,
    status: parts.has('status') ? parseStatus(statusText) : null,
    commits: parseCommitLines(commits),
    truncated: {
      branches: localRefs.truncated,
      remoteBranches: remoteRefs.truncated,
      tags: tagRefs.truncated,
    },
  };
}
