import { readdir, readFile, unlink, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { stateDir } from './stateDir';

// The pid of the server on a given port, so `hunk stop` and `hunk status` can
// find it without asking the system what holds the socket.
//
// Asking the socket is not an option under socket activation: the service
// manager starts the server when something connects, so a question about
// whether anything is running would be what makes something run. An activated
// server also takes an ephemeral port, so there is no port to ask on -- it
// records its pid under the registered one instead.
function pidPath(port: number): string {
  return join(stateDir(), `daemon-${port}.pid`);
}

export async function writeDaemonPid(port: number): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(pidPath(port), `${process.pid}\n`);
}

export async function clearDaemonPid(port: number): Promise<void> {
  await unlink(pidPath(port)).catch(() => undefined);
}

// The pid, or null when there is no file or the process it names is gone. A
// stale file outlives a server that was killed rather than stopped, so the
// process is checked rather than trusted.
export async function readDaemonPid(port: number): Promise<number | null> {
  let pid: number;
  try {
    pid = Number((await readFile(pidPath(port), 'utf8')).trim());
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    // Signal 0 checks the process exists without touching it.
    process.kill(pid, 0);
    return pid;
  } catch {
    await clearDaemonPid(port);
    return null;
  }
}

// Every port a live server is recorded on. A server run by hand takes whichever
// port it was given, so finding one means looking at what is there rather than
// guessing where it would be.
export async function listDaemonPorts(): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(stateDir());
  } catch {
    return [];
  }

  const ports: number[] = [];
  for (const name of names) {
    const match = /^daemon-(\d+)\.pid$/.exec(name);
    if (match?.[1] == null) continue;
    const port = Number(match[1]);
    // readDaemonPid drops the file when the process is gone, so this both
    // filters and tidies.
    if ((await readDaemonPid(port)) != null) ports.push(port);
  }
  return ports;
}
