import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  assetName,
  assetUrl,
  isNewerVersion,
  latestReleaseUrl,
  normalizeVersion,
  parseChecksums,
} from '../lib/update';
import { isCompiledBinary } from './cli-core';
import { bold, cyan, dim, errorPrefix, green, yellow } from './style';

function fail(message: string, hint?: string): never {
  process.stderr.write(`${errorPrefix()} ${message}\n`);
  if (hint != null) process.stderr.write(`\n${dim(hint)}\n`);
  process.exit(1);
}

// Alpine and friends need the musl build, and ldd naming itself is the reliable
// tell -- the same check the install script makes.
function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const result = spawnSync('ldd', ['--version'], { encoding: 'utf8' });
  return /musl/i.test(`${result.stdout ?? ''}${result.stderr ?? ''}`);
}

async function fetchText(url: string, what: string): Promise<string> {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (response == null || !response.ok) {
    fail(
      `could not reach GitHub to ${what}`,
      'Check your connection, or download a release by hand from\n' +
        'https://github.com/jatindotdev/hunkyard/releases'
    );
  }
  return await response.text();
}

// Streams rather than buffering, so a 75MB download can report progress. Without
// it the command prints nothing for a minute, which reads as a hang.
async function download(url: string, to: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(600_000),
  }).catch(() => null);
  if (response == null || !response.ok || response.body == null) {
    fail(
      `could not download ${url}`,
      'The release may not have an asset for this platform. See\n' +
        'https://github.com/jatindotdev/hunkyard/releases'
    );
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastShown = -1;

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    received += chunk.length;
    if (total > 0 && process.stdout.isTTY === true) {
      const percent = Math.floor((received / total) * 100);
      if (percent !== lastShown) {
        lastShown = percent;
        process.stdout.write(`\r  ${dim(`downloading ${percent}%`)}`);
      }
    }
  }
  if (lastShown >= 0) process.stdout.write('\r\u001b[2K');

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  await writeFile(to, bytes);
  return bytes;
}

export interface UpdateOptions {
  version: string;
  // Restarts the server afterwards, so the new binary is the one answering.
  // Supplied by the CLI, which knows whether an agent owns the process.
  restart(): Promise<void>;
  check: boolean;
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  if (!isCompiledBinary()) {
    fail(
      'update replaces the compiled binary, and this is running from a checkout',
      'Use `bun run build` here. `hunk update` is for an installed release.'
    );
  }

  const asset = assetName({
    platform: process.platform,
    arch: process.arch,
    musl: isMusl(),
  });
  if (asset == null) {
    fail(
      `no release is published for ${process.platform}/${process.arch}`,
      'See https://github.com/jatindotdev/hunkyard/releases'
    );
  }

  const body = (await fetchText(latestReleaseUrl(), 'find the latest release')) || '';
  const tag = (JSON.parse(body) as { tag_name?: string }).tag_name;
  if (tag == null || tag === '') {
    fail('GitHub did not name a latest release');
  }

  const latest = normalizeVersion(tag);
  const current = normalizeVersion(options.version);
  if (!isNewerVersion(latest, current)) {
    process.stdout.write(
      `  ${green('✓')} ${bold(`hunk ${current}`)} ${dim(
        latest === current ? 'is the latest' : `is ahead of the latest (${latest})`
      )}\n`
    );
    return;
  }

  if (options.check) {
    process.stdout.write(
      `  ${yellow('↑')} ${bold(`hunk ${latest}`)} ${dim(`is out, you have ${current}. hunk update`)}\n`
    );
    return;
  }

  // The binary may be reached through the git-hunk symlink, and replacing the
  // link rather than its target would leave `hunk` itself on the old version.
  const target = await realpath(process.execPath);
  const directory = dirname(target);
  try {
    accessSync(directory, constants.W_OK);
  } catch {
    fail(
      `${directory} is not writable`,
      `Re-run with sudo, or reinstall with the install script.`
    );
  }

  process.stdout.write(`${dim(`hunk ${current} → ${latest}`)}\n`);

  // Staged in the target's own directory rather than /tmp: the swap below is a
  // rename, and rename cannot cross filesystems.
  const staging = await mkdtemp(join(directory, '.hunk-update-'));
  try {
    const downloaded = join(staging, 'hunk');
    const bytes = await download(assetUrl(asset, tag), downloaded);

    const sums = await fetch(assetUrl('SHA256SUMS', tag), {
      signal: AbortSignal.timeout(30_000),
    })
      .then((response) => (response.ok ? response.text() : null))
      .catch(() => null);
    if (sums != null) {
      const expected = parseChecksums(sums).get(asset);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (expected != null && expected !== actual) {
        fail(
          `checksum mismatch for ${asset}`,
          'The download does not match what the release says it should be, so it\nhas not been installed.'
        );
      }
    }

    await chmod(downloaded, 0o755);
    // A rename, not a copy over the top. Replacing a running executable in
    // place is what kills processes that have it mapped; a rename swaps the
    // directory entry and leaves the old inode alone until they exit.
    await rename(downloaded, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  process.stdout.write(
    `  ${green('✓')} ${bold(cyan(`hunk ${latest}`))} ${dim(target)}\n`
  );

  // A server that is already running keeps serving the binary it started with,
  // so without this the update is on disk and not in use.
  await options.restart();
}
