import { spawn } from 'node:child_process';

export interface GitExecResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

export class GitError extends Error {
  readonly code: number;
  readonly stderr: string;

  constructor(args: readonly string[], code: number, stderr: string) {
    // git puts the useful line first and usually prefixes it with `fatal:`.
    const detail = stderr.split('\n').find((line) => line.trim().length > 0);
    super(detail ?? `git ${args.join(' ')} exited with ${code}`);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
  }
}

// `git diff` exits 0 with output and 0 when there is nothing to report, but the
// `--no-index` form mimics diff(1) and exits 1 to mean "the files differ". A
// revspec git cannot resolve exits 128. So 0 and 1 are both success here, and
// anything above is a real failure worth surfacing.
const MAX_SUCCESS_CODE = 1;

export function isGitSuccess(code: number): boolean {
  return code >= 0 && code <= MAX_SUCCESS_CODE;
}

export async function runGit(
  args: readonly string[],
  options: { cwd: string; maxBuffer?: number }
): Promise<GitExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      // Never inherit a terminal: a repo needing credentials must fail rather
      // than block on a prompt no one can answer.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });

    const stdout: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout: Buffer.concat(stdout), stderr, code: code ?? -1 });
    });
  });
}

// Runs git and rejects unless the exit code means success.
export async function git(
  args: readonly string[],
  options: { cwd: string }
): Promise<string> {
  const result = await runGit(args, options);
  if (!isGitSuccess(result.code)) {
    throw new GitError(args, result.code, result.stderr);
  }
  return result.stdout.toString('utf8');
}

// Streams stdout instead of buffering, for diffs that can reach millions of
// lines.
//
// The consumer must never be able to hang: git can fail before producing a
// byte, so the child's exit is what settles the stream, not stdout ending. If
// it exits badly the stream errors; if it exits cleanly the stream closes. The
// `done` promise mirrors the same outcome for callers that ignore the body.
//
// Prefer validating a revspec up front (see verifyRev) over relying on this:
// once the first byte is written the HTTP status is already committed, so a
// mid-stream failure cannot become a 400.
export function streamGit(
  args: readonly string[],
  options: { cwd: string }
): { stream: ReadableStream<Uint8Array>; done: Promise<void> } {
  const child = spawn('git', args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  let settle: (error?: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve());
  });
  // Swallow the rejection if nobody awaited `done`; the stream already carries
  // the same error, and an unhandled rejection would take the process down.
  void done.catch(() => {});

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // A controller may only be closed or errored once, and stdout ending and
      // the child exiting race each other.
      let finished = false;
      const finish = (error?: Error) => {
        if (!finished) {
          finished = true;
          if (error) controller.error(error);
          else controller.close();
        }
        settle(error);
      };

      let stdoutEnded = false;
      let exit: { code: number } | null = null;

      const resolveOutcome = () => {
        // Wait for both signals when the run is succeeding, so no trailing
        // output is dropped; fail as soon as a bad exit is known.
        if (exit == null) return;
        if (!isGitSuccess(exit.code)) {
          finish(new GitError(args, exit.code, stderr));
          return;
        }
        if (stdoutEnded) finish();
      };

      child.stdout.on('data', (chunk: Buffer) => {
        if (!finished) controller.enqueue(chunk);
      });
      child.stdout.on('end', () => {
        stdoutEnded = true;
        resolveOutcome();
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        exit = { code: code ?? -1 };
        resolveOutcome();
      });
    },
    cancel() {
      child.kill('SIGTERM');
    },
  });

  return { stream, done };
}

// Cheap existence check so a bad revspec becomes a 400 before any bytes are
// committed to the response. Returns the resolved object id, or null.
export async function verifyRev(
  rev: string,
  options: { cwd: string }
): Promise<string | null> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', rev], options);
  if (!isGitSuccess(result.code)) return null;
  const id = result.stdout.toString('utf8').trim();
  return id === '' ? null : id;
}

// The repository root for a directory, or null when outside a work tree.
export async function findRepoRoot(cwd: string): Promise<string | null> {
  let result;
  try {
    result = await runGit(['rev-parse', '--show-toplevel'], { cwd });
  } catch {
    // A cwd that does not exist fails the spawn itself rather than returning a
    // git exit code. "Not a repository" is the honest answer either way, and
    // the alternative is an ENOENT about posix_spawn reaching the caller.
    return null;
  }
  if (!isGitSuccess(result.code)) return null;
  const root = result.stdout.toString('utf8').trim();
  return root === '' ? null : root;
}
