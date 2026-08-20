// Pure argument handling, kept out of hunk.mjs so it can be unit tested
// without spawning a server.

export const DEFAULT_PORT = 4865;
export const HOSTNAME = 'hunkyard.localhost';

export class CliError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'CliError';
    this.hint = hint;
  }
}

export const HELP = `hunk - review code changes from a local repository or a pull request

Usage
  hunk [target] [options]

Targets
  (none)             unstaged changes in the working tree
  --staged           staged changes only
  --all              staged and unstaged together
  <revspec>          main...feature, HEAD~3, a1b2c3d, v1.0...v2.0
  owner/repo#123     a GitHub pull request
  <github url>       a github.com pull request, commit or compare URL

  A three-dot range is diffed against the merge base, the same anchor GitHub
  uses for a pull request, so line numbers agree with the eventual PR.

Options
  -p, --port <n>     port to serve on (default ${DEFAULT_PORT})
      --no-open      print the URL instead of opening a browser
  -h, --help         show this message
  -v, --version      print the version

Examples
  hunk                          review what you have not committed
  hunk --staged                 review what you are about to commit
  hunk main...my-branch         review a branch as a PR would show it
  hunk HEAD                     review the last commit
  hunk headout/absolut#1527     review a pull request
`;

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(
      `--port needs a number between 1 and 65535, got ${value ?? '(nothing)'}`
    );
  }
  return port;
}

export function parseArgs(argv) {
  const options = { open: true, port: DEFAULT_PORT, help: false, version: false };
  const targets = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { ...options, help: true };
    if (arg === '-v' || arg === '--version') return { ...options, version: true };
    if (arg === '--no-open') {
      options.open = false;
      continue;
    }
    if (arg === '-p' || arg === '--port') {
      options.port = parsePort(argv[++i]);
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = parsePort(arg.slice('--port='.length));
      continue;
    }
    // `--staged`, `--cached` and `--all` are targets rather than options, so
    // they fall through to be collected instead of rejected as unknown flags.
    targets.push(arg);
  }

  if (targets.length > 1) {
    throw new CliError(
      `expected one target, got ${targets.length}: ${targets.join(' ')}`,
      'A revspec containing spaces needs quoting.'
    );
  }
  return { ...options, target: targets[0] };
}

// Recognises the GitHub forms so `hunk owner/repo#1` works, and treats anything
// else as a local revspec. Deliberately conservative: a bare `foo/bar` is far
// likelier to be a branch than a repository, so it stays local.
export function resolveViewerPath(target) {
  if (target == null) return { kind: 'local', path: '/local' };

  const shorthand = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(target);
  if (shorthand != null) {
    const [, owner, repo, number] = shorthand;
    return { kind: 'github', path: `/${owner}/${repo}/pull/${number}` };
  }

  if (/^https?:\/\//i.test(target)) {
    let url;
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

export function viewerUrl(port, path) {
  return `http://${HOSTNAME}:${port}${path}`;
}
