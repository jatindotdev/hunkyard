#!/usr/bin/env bun
// Walks the compiled binary's commands against a real repository.
//
//   bun scripts/smoke.ts [path-to-binary]
//
// This exists because the unit tests never invoke the binary. Everything it
// catches is a thing 282 passing tests said nothing about: a client that was not
// embedded, `--version` printing usage and exiting 1, an unknown flag being
// ignored, `hunk stop` needing lsof.
//
// It runs its own daemon on an unlikely port and redirects the state directory,
// so it neither reads nor writes the registry of whoever runs it.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Absolute, because every command runs with its cwd inside a scratch repository
// and a relative path would resolve against that.
const binary = resolve(process.argv[2] ?? 'dist/hunk');
if (!(await Bun.file(binary).exists())) {
  console.error(`No binary at ${binary}. Run \`bun run build\` first.`);
  process.exit(1);
}
const PORT = 4877;
const FORWARD_PORT = 4878;

const version = (await Bun.file('package.json').json()).version as string;
const base = await mkdtemp(join(tmpdir(), 'hunk-smoke-'));
const state = join(base, 'state');
const repoA = join(base, 'a');
const repoB = join(base, 'b');

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: string): void {
  checks++;
  if (ok) {
    console.log(`  ok    ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL  ${what}${detail == null ? '' : `\n          ${detail}`}`);
}

interface Ran {
  status: number;
  out: string;
}

function hunk(args: string[], cwd = repoA): Ran {
  const result = Bun.spawnSync([binary, ...args], {
    cwd,
    env: { ...process.env, XDG_STATE_HOME: state },
  });
  return {
    status: result.exitCode,
    out: `${result.stdout.toString()}${result.stderr.toString()}`.trim(),
  };
}

async function get(path: string): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: String(error) };
  }
}

async function git(args: string[], cwd: string): Promise<void> {
  const result = Bun.spawnSync(['git', ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
}

async function makeRepo(path: string, marker: string): Promise<void> {
  await writeFile(join(path, '.keep'), '');
  await git(['init', '-q', '-b', 'main'], path);
  await git(['config', 'user.email', 'smoke@example.com'], path);
  await git(['config', 'user.name', 'Smoke'], path);
  await git(['config', 'commit.gpgsign', 'false'], path);
  await writeFile(join(path, 'a.ts'), 'export const a = 1;\n');
  await git(['add', '-A'], path);
  await git(['commit', '-qm', 'first'], path);
  await writeFile(join(path, 'a.ts'), `export const a = 1;\n${marker}\n`);
}

try {
  await Bun.$`mkdir -p ${repoA} ${repoB}`.quiet();
  await makeRepo(repoA, 'export const ONLY_A = 1;');
  await makeRepo(repoB, 'export const ONLY_B = 2;');

  console.log('\nthe binary answers for itself');
  check(`--version prints ${version}`, hunk(['--version']).out === version);
  const help = hunk(['--help']).out;
  check(
    '--help lists the commands',
    ['status', 'stop', 'install', 'uninstall'].every((c) => help.includes(c)),
    help.slice(0, 120)
  );

  console.log('\nstarting, and serving');
  const started = hunk(['--no-open', '--port', String(PORT)]);
  check('bare hunk starts and returns', started.status === 0, started.out);
  check('it prints the URL', started.out.includes(`:${PORT}/local?repo=`), started.out);

  const health = await get('/api/health');
  check('/api/health identifies us', health.body.includes('"app":"hunkyard"'), health.body);
  const index = await get('/');
  check('the embedded client serves', index.status === 200 && /<title>/i.test(index.body));

  const repos = await get('/api/repos');
  const repoId = /"id":"([^"]+)"/.exec(repos.body)?.[1];
  check('the repository is registered', repoId != null, repos.body.slice(0, 120));
  const diff = await get(`/api/local-diff?repo=${repoId ?? ''}`);
  check('the diff has the change in it', diff.body.includes('ONLY_A'), diff.body.slice(0, 120));

  console.log('\nevery target spelling');
  for (const [args, expected] of [
    [['--worktree'], '/local/--worktree'],
    [['--all'], '/local/--all'],
    [['HEAD'], '/local/HEAD'],
    [['main...main'], '/local/main...main'],
    [['facebook/react#28000'], '/facebook/react/pull/28000'],
  ] as const) {
    const ran = hunk([...args, '--no-open', '--port', String(PORT)]);
    check(`hunk ${args.join(' ')}`, ran.out.includes(expected), ran.out);
  }
  await git(['add', '-A'], repoA);
  const staged = hunk(['--staged', '--no-open', '--port', String(PORT)]);
  check('hunk --staged', staged.out.includes('/local/--staged'), staged.out);
  const cached = hunk(['--cached', '--no-open', '--port', String(PORT)]);
  check('hunk --cached is the same target', cached.out.includes('/local/--staged'), cached.out);
  await git(['reset', '-q'], repoA);

  console.log('\na second repository, on the same daemon');
  const second = hunk(['--no-open', '--port', String(PORT)], repoB);
  check('it reuses the running server', second.status === 0, second.out);
  const status = hunk(['status', '--port', String(PORT)]);
  check('status names both repositories', /a-[a-f0-9]+/.test(status.out) && /b-[a-f0-9]+/.test(status.out), status.out);
  check('status reports the version', status.out.includes(version), status.out);
  check('status reports the login agent', status.out.includes('login agent'), status.out);

  console.log('\nrefusing what it should refuse');
  const typo = hunk(['--stagedd', '--no-open', '--port', String(PORT)]);
  check('an unknown option fails', typo.status !== 0 && typo.out.includes('unknown option'), typo.out);
  const badPort = hunk(['--no-open', '--port', '99999']);
  check('a port out of range fails', badPort.status !== 0, badPort.out);
  const twoTargets = hunk(['--staged', 'HEAD', '--no-open', '--port', String(PORT)]);
  check('two targets fail', twoTargets.status !== 0 && twoTargets.out.includes('one target'), twoTargets.out);
  const targetOutsideRepo = hunk(['HEAD~1', '--no-open', '--port', String(PORT)], base);
  check(
    'a revspec outside a repository fails',
    targetOutsideRepo.status !== 0 && targetOutsideRepo.out.includes('not inside a git repository'),
    targetOutsideRepo.out
  );
  const unknownRepo = await get('/api/local-diff?repo=nope-12345678');
  check('an unknown repository id is a 404', unknownRepo.status === 404, String(unknownRepo.status));
  const rebound = await (async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/repos`, {
      headers: { Host: 'evil.example.com' },
    }).catch(() => null);
    return response?.status ?? 0;
  })();
  check('a rebound Host is refused', rebound === 403, String(rebound));

  console.log('\noutside a repository');
  const opener = hunk(['--no-open', '--port', String(PORT)], base);
  check(
    'bare hunk opens the picker instead of failing',
    opener.status === 0 && opener.out.trim().endsWith(`:${PORT}/`),
    opener.out
  );

  console.log('\nserve, which is what the login agent runs');
  const serveHelp = hunk(['serve', '--help']);
  check('serve is a command', serveHelp.status === 0 && serveHelp.out.includes('--port'), serveHelp.out);

  console.log('\nthe port forwarder');
  const forward = Bun.spawn(
    [binary, 'forward', '--from', String(FORWARD_PORT), '--to', String(PORT)],
    { env: { ...process.env, XDG_STATE_HOME: state }, stdout: 'ignore', stderr: 'ignore' }
  );
  await Bun.sleep(1500);
  const throughForwarder = await fetch(
    `http://127.0.0.1:${FORWARD_PORT}/api/health`
  )
    .then((r) => r.text())
    .catch((error: unknown) => String(error));
  check(
    'a request reaches the server through it',
    throughForwarder.includes('"app":"hunkyard"'),
    throughForwarder.slice(0, 120)
  );
  forward.kill();

  console.log('\nstopping');
  const stopped = hunk(['stop', '--port', String(PORT)]);
  check('stop reports it stopped', stopped.status === 0 && stopped.out.includes('Stopped'), stopped.out);
  await Bun.sleep(500);
  check('nothing answers afterwards', (await get('/api/health')).status === 0);
  const stopAgain = hunk(['stop', '--port', String(PORT)]);
  check('stopping again says so plainly', stopAgain.out.includes('No hunk server'), stopAgain.out);
} finally {
  hunk(['stop', '--port', String(PORT)]);
  await rm(base, { recursive: true, force: true });
}

console.log(
  `\n${checks - failures}/${checks} checks passed\n`
);
process.exit(failures === 0 ? 0 : 1);
