import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearDaemonPid,
  readDaemonPid,
  writeDaemonPid,
} from '@/lib/repos/daemonPid';

let stateHome: string;
let previous: string | undefined;

beforeEach(async () => {
  stateHome = await mkdtemp(join(tmpdir(), 'hunk-pid-'));
  previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
});

afterEach(async () => {
  if (previous == null) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previous;
  await rm(stateHome, { recursive: true, force: true });
});

describe('daemon pid file', () => {
  test('round-trips the current process', async () => {
    await writeDaemonPid(4865);
    expect(await readDaemonPid(4865)).toBe(process.pid);
  });

  test('is absent for a port with no server', async () => {
    expect(await readDaemonPid(4999)).toBeNull();
  });

  test('clears', async () => {
    await writeDaemonPid(4865);
    await clearDaemonPid(4865);
    expect(await readDaemonPid(4865)).toBeNull();
  });

  // A server killed rather than stopped leaves its pid behind, and that pid is
  // eventually reused by something unrelated. Reporting it would have `hunk
  // stop` signal a stranger.
  test('treats a pid that is gone as no server, and removes the file', async () => {
    await mkdir(join(stateHome, 'hunkyard'), { recursive: true });
    const path = join(stateHome, 'hunkyard', 'daemon-4865.pid');
    await writeFile(path, '999999\n');
    expect(await readDaemonPid(4865)).toBeNull();
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  test('ignores a file that is not a pid', async () => {
    await mkdir(join(stateHome, 'hunkyard'), { recursive: true });
    await writeFile(join(stateHome, 'hunkyard', 'daemon-4865.pid'), 'nonsense\n');
    expect(await readDaemonPid(4865)).toBeNull();
  });
});
