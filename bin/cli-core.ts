// Resolving a target to a viewer path, kept out of the entry point so it can be
// unit tested without starting a server. Argument parsing itself is citty's.

export const DEFAULT_PORT = 4865;
export const HOSTNAME = 'hunkyard.localhost';

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

export function viewerUrl(port: number, path: string): string {
  return `http://${HOSTNAME}:${port}${path}`;
}
