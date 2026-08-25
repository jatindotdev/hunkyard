import { readdir, readFile, unlink, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { stateDir } from './stateDir';

// The pid of the server on a given port, so `hunk service stop` and
// `hunk service status` can
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

export interface DaemonRecord {
  pid: number;
  // The port the server is actually listening on, which is not the port this
  // record is filed under: an activated server is filed under the registered
  // port and listens on an ephemeral one.
  //
  // Recorded so anything asking after it can go straight to the server rather
  // than through the registered socket. Connections through that socket are
  // what "in use" is counted from, so a status check that went that way would
  // keep alive the server it was reporting on.
  port: number;
}

export async function writeDaemonPid(
  port: number,
  servingPort = port
): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(
    pidPath(port),
    `${JSON.stringify({ pid: process.pid, port: servingPort })}\n`
  );
}

export async function clearDaemonPid(port: number): Promise<void> {
  await unlink(pidPath(port)).catch(() => undefined);
}

// The pid, or null when there is no file or the process it names is gone. A
// stale file outlives a server that was killed rather than stopped, so the
// process is checked rather than trusted.
export async function readDaemonRecord(
  port: number
): Promise<DaemonRecord | null> {
  let raw: string;
  try {
    raw = (await readFile(pidPath(port), 'utf8')).trim();
  } catch {
    return null;
  }

  let record: DaemonRecord | null = null;
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonRecord>;
    if (Number.isInteger(parsed.pid) && (parsed.pid ?? 0) > 0) {
      record = {
        pid: parsed.pid as number,
        port: Number.isInteger(parsed.port) ? (parsed.port as number) : port,
      };
    }
  } catch {
    // Not a record: garbage, or a file written by a version that stored a bare
    // pid. Either way it names nothing we can check.
  }

  // Removed rather than left, or an unreadable file outlives every server and
  // is never cleaned up by anything.
  if (record == null) {
    await clearDaemonPid(port);
    return null;
  }

  try {
    // Signal 0 checks the process exists without touching it.
    process.kill(record.pid, 0);
    return record;
  } catch {
    await clearDaemonPid(port);
    return null;
  }
}

export async function readDaemonPid(port: number): Promise<number | null> {
  return (await readDaemonRecord(port))?.pid ?? null;
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
