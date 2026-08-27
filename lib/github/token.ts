import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stateDir } from '@/lib/repos/stateDir';

// The GitHub token the local server holds on the user's behalf.
//
// Under the local-first model the CLI resolves a token once at startup (from
// `gh auth token`, or GH_TOKEN/GITHUB_TOKEN) and keeps it in this process. The
// browser never receives it, which is the whole point: a token that can write
// reviews should not sit in localStorage where any script on the page can read
// it.
//
// A token pasted into the UI still works and takes precedence, for anyone
// without `gh` installed.

let cached: string | null = null;
let askedAt = 0;

// Long enough that a server started by the login agent is not shelling out per
// request, short enough that `gh auth login` starts working without a restart.
const NEGATIVE_TTL_MS = 60_000;

// What the CLI wrote down, from a shell that had one. Read synchronously
// because everything reading a token here is, and the file is a line long.
function tokenFromStore(): string | null {
  try {
    const token = readFileSync(join(stateDir(), 'github-token'), 'utf8').trim();
    return token === '' ? null : token;
  } catch {
    return null;
  }
}

// A last resort, and often a dead end: `gh` frequently reads GITHUB_TOKEN from
// the environment rather than storing one, so a process with no shell asking
// `gh` gets the same nothing it already had. It still helps for anyone whose
// `gh` does hold its own credential.
function tokenFromGh(): string | null {
  try {
    const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    const token = result.status === 0 ? (result.stdout ?? '').trim() : '';
    return token === '' ? null : token;
  } catch {
    return null;
  }
}

export function resolveServerGitHubToken(): string | undefined {
  const candidates = [
    process.env.HUNKYARD_GITHUB_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_TOKEN,
  ];
  for (const candidate of candidates) {
    if (candidate != null && candidate.trim() !== '') return candidate.trim();
  }

  // Memoised: a found token never changes for the life of the process, and a
  // missing one is re-checked occasionally rather than on every request -- which
  // is also how a token stored after the server started gets picked up without
  // restarting it.
  if (cached != null) return cached;
  if (Date.now() - askedAt < NEGATIVE_TTL_MS && askedAt !== 0) return undefined;
  askedAt = Date.now();
  cached = tokenFromStore() ?? tokenFromGh();
  return cached ?? undefined;
}

// Whether the server can talk to GitHub without the browser supplying anything,
// so the UI can say so instead of asking for a token it does not need.
export function hasServerGitHubToken(): boolean {
  return resolveServerGitHubToken() != null;
}
