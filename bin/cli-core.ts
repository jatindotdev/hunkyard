// Resolving a target to a viewer path, kept out of the entry point so it can be
// unit tested without starting a server. Argument parsing itself is citty's.

import { BARE_ORIGIN } from '../lib/proxy/canonical';

export const DEFAULT_PORT = 4865;

// Whether this is running as the compiled executable rather than from a
// checkout.
//
// argv[1], not import.meta.path: `--bytecode` makes import.meta.path the
// original source path, so a check against it silently answers "not compiled"
// for exactly the binary that ships.
export function isCompiledBinary(argv = process.argv): boolean {
  return argv[1]?.startsWith('/$bunfs/') === true;
}

// The command that re-runs this executable. A compiled binary is its own
// execPath and needs no script argument; run from a checkout, execPath is bun
// itself, so the entry has to be named -- and the caller names it, since the
// entry is bin/hunk.ts rather than this file.
export function selfCommand(
  entry: string,
  argv = process.argv,
  execPath = process.execPath
): string[] {
  return isCompiledBinary(argv) ? [execPath] : [execPath, entry];
}

export class CliError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.hint = hint;
  }
}

export interface ViewerTarget {
  kind: 'local' | 'github';
  path: string;
}

// Recognises the GitHub forms so `hunk owner/repo#1` works, and treats anything
// else as a local revspec. Deliberately conservative: a bare `foo/bar` is far
// likelier to be a branch than a repository, so it stays local.
// Which origin a review should be handed over on.
//
// There is one URL for this app and it is the bare host: two origins would
// split browser storage, so viewed state and display preferences would depend
// on which of them you happened to open. Falling back to the ported URL is what
// causes that, so it is not offered -- the answer to a missing forwarder is to
// install it, once.
//
// A port chosen by hand is the exception. The forwarder points at one port, so
// asking for another is asking not to be behind it, and refusing there would
// make --port useless.
export type ReviewOrigin =
  | { kind: 'origin'; origin: string }
  | { kind: 'needs-install' };

export function resolveReviewOrigin(options: {
  port: number;
  bareReachable: boolean;
}): ReviewOrigin {
  // Asking for a particular port is asking not to be behind the registered one.
  if (options.port !== DEFAULT_PORT) {
    return { kind: 'origin', origin: `${BARE_ORIGIN}:${options.port}` };
  }
  return options.bareReachable
    ? { kind: 'origin', origin: BARE_ORIGIN }
    : { kind: 'needs-install' };
}

export function resolveViewerPath(
  target: string | undefined
): ViewerTarget {
  if (target == null) return { kind: 'local', path: '/local' };

  const shorthand = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(target);
  if (shorthand != null) {
    const [, owner, repo, number] = shorthand;
    return { kind: 'github', path: `/${owner}/${repo}/pull/${number}` };
  }

  if (/^https?:\/\//i.test(target)) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new CliError(`could not parse ${target} as a URL`);
    }
    if (!/(^|\.)github\.com$/i.test(url.hostname)) {
      throw new CliError(
        `${url.hostname} is not supported`,
        'Only github.com URLs work as targets. For a local review, pass a revspec.'
      );
    }
    return { kind: 'github', path: url.pathname.replace(/\/+$/, '') };
  }

  return { kind: 'local', path: `/local/${encodeURIComponent(target)}` };
}
