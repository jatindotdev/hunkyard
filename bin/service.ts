import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import {
  BARE_PORT,
  PROXY_LABEL,
  launchdPlist,
  launchdPlistPath,
  logPath,
  servicePlatform,
  systemdSocketPath,
  systemdSocketUnit,
  systemdUnit,
  systemdUnitPath,
} from '../lib/proxy/service';
import { BARE_ORIGIN } from '../lib/proxy/canonical';
import { stateDir } from '../lib/repos/stateDir';
import { isCompiledBinary } from './cli-core';
import { bold, cyan, dim, errorPrefix, green } from './style';

function fail(message: string, hint?: string): never {
  process.stderr.write(`${errorPrefix()} ${message}\n`);
  if (hint != null) process.stderr.write(`\n${dim(hint)}\n`);
  process.exit(1);
}

// The executable to register. A compiled binary is its own path; run from a
// checkout there is no stable path to register, and pointing the service at a
// temp file would break on the next build.
function serviceExecutable(): string {
  if (!isCompiledBinary()) {
    fail(
      'registering needs the compiled binary',
      'Run `bun run build` and use dist/hunk, or install a release.'
    );
  }
  return process.execPath;
}

// A step that is allowed to fail, because there is a state in which failing is
// the correct outcome. Unloading something that was never loaded is the whole
// of that category: launchd answers `Boot-out failed: 5: Input/output error`,
// and on a first install that is simply what "not loaded" sounds like.
interface Step {
  argv: string[];
  tolerated?: boolean;
}

// One shape for every outcome line.
function done(label: string, detail: string): string {
  return `  ${green('✓')} ${label.padEnd(12)} ${detail}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

// Whether the file already says exactly what we would write. Comparing the
// contents rather than merely the path is what catches a registration whose
// binary has since moved, or whose user has changed.
async function alreadyWritten(path: string, contents: string): Promise<boolean> {
  try {
    return (await readFile(path, 'utf8')) === contents;
  } catch {
    return false;
  }
}

// Writes root-owned files by staging them somewhere writable and moving them
// with sudo, so the password prompt happens once and nothing else runs
// privileged.
async function installPrivileged(
  files: readonly { contents: string; destination: string }[],
  after: readonly Step[]
): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), 'hunk-service-'));

  // The staging moves go first, and are never tolerated, so one of them is the
  // step that prompts for the password. Anything silenced below therefore runs
  // against a fresh sudo timestamp -- silencing a step that still needed to
  // prompt would be a hang with nothing on screen.
  const steps: Step[] = [];
  for (const [index, file] of files.entries()) {
    const staged = join(staging, `unit-${index}`);
    await writeFile(staged, file.contents);
    steps.push({
      argv: ['install', '-m', '0644', '-o', 'root', staged, file.destination],
    });
  }
  steps.push(...after);

  for (const step of steps) {
    const result = spawnSync('sudo', step.argv, {
      stdio: step.tolerated === true ? 'ignore' : 'inherit',
    });
    if (result.status !== 0 && step.tolerated !== true) {
      fail(`\`sudo ${step.argv.join(' ')}\` failed`);
    }
  }
}

interface Registration {
  files: { contents: string; destination: string }[];
  load: Step[];
  unload: Step[];
}

function registration(executable: string, user: string): Registration {
  if (servicePlatform() === 'darwin') {
    const path = launchdPlistPath();
    return {
      files: [{ contents: launchdPlist(executable, user), destination: path }],
      load: [
        // Unloading first is what makes reinstalling pick up a new plist, and
        // on a first install there is nothing to unload.
        { argv: ['launchctl', 'bootout', 'system', path], tolerated: true },
        { argv: ['launchctl', 'bootstrap', 'system', path] },
      ],
      unload: [
        { argv: ['launchctl', 'bootout', 'system', path], tolerated: true },
        { argv: ['rm', '-f', path] },
      ],
    };
  }

  // systemd splits it in two: a socket unit that binds and holds the port, and
  // the service it starts when that socket sees a connection.
  return {
    files: [
      { contents: systemdSocketUnit(), destination: systemdSocketPath() },
      { contents: systemdUnit(executable, user), destination: systemdUnitPath() },
    ],
    load: [
      { argv: ['systemctl', 'daemon-reload'] },
      { argv: ['systemctl', 'enable', '--now', `${PROXY_LABEL}.socket`] },
    ],
    unload: [
      {
        argv: ['systemctl', 'disable', '--now', `${PROXY_LABEL}.socket`],
        tolerated: true,
      },
      { argv: ['rm', '-f', systemdSocketPath(), systemdUnitPath()] },
    ],
  };
}

// Whether the service manager is holding the port right now, as opposed to
// merely having a file for it. Nothing needs to be running for this to be true:
// the socket is bound by the manager, which is the whole point.
async function portIsHeld(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const settle = (answer: boolean) => resolve(answer);
    const timer = setTimeout(() => settle(false), 1500);
    void Bun.connect({
      hostname: '127.0.0.1',
      port: BARE_PORT,
      socket: {
        open: (connection) => {
          clearTimeout(timer);
          connection.end();
          settle(true);
        },
        data: () => {},
        error: () => {
          clearTimeout(timer);
          settle(false);
        },
      },
    }).catch(() => {
      clearTimeout(timer);
      settle(false);
    });
  });
}

// Whether hunkyard.localhost is registered, asked by looking rather than by
// connecting.
//
// Connecting would answer more precisely and cost more than it is worth: the
// service manager starts the server when something connects, so a `hunk service status`
// that probed the port would start a server in order to report that none was
// running.
export async function serviceIsRegistered(): Promise<boolean> {
  const { files } = registration('hunk', userInfo().username);
  const present = await Promise.all(
    files.map((file) => exists(file.destination))
  );
  return present.every(Boolean);
}

// Running this twice must be the same as running it once, and the second run
// must not ask for a password to do nothing.
export async function installService(): Promise<void> {
  const executable = serviceExecutable();
  const user = userInfo().username;
  const { files, load } = registration(executable, user);

  const written = await Promise.all(
    files.map((file) => alreadyWritten(file.destination, file.contents))
  );
  if (written.every(Boolean) && (await portIsHeld())) {
    process.stdout.write(done('registered', `${bold(cyan(BARE_ORIGIN))} ${dim('already')}`));
    return;
  }

  process.stdout.write(
    `Registering ${bold(cyan(BARE_ORIGIN))}. ` +
      `${dim(`Binding port ${BARE_PORT} needs sudo, once.`)}\n\n`
  );

  // The log has to exist and be yours before a service running as you writes to
  // it, or the job fails to start with nothing to say why.
  await mkdir(stateDir(), { recursive: true });
  await writeFile(logPath(user), '', { flag: 'a' });

  await installPrivileged(files, load);

  process.stdout.write(
    done('registered', bold(cyan(BARE_ORIGIN))) +
      done('starts', dim('on the first request, as you rather than as root')) +
      done('stops', dim('once nothing has been connected for a few minutes'))
  );
}

export async function uninstallService(): Promise<void> {
  // The executable only shapes the file contents, which are about to be deleted.
  const { files, unload } = registration('hunk', userInfo().username);

  const present = await Promise.all(files.map((file) => exists(file.destination)));
  if (!present.some(Boolean)) {
    process.stdout.write(`${dim('Nothing to remove.')}\n`);
    return;
  }

  process.stdout.write(
    `Removing. ${dim(`Releasing port ${BARE_PORT} needs sudo, once.`)}\n\n`
  );
  for (const step of unload) {
    // Output is inherited rather than swallowed because the first of these is
    // what prompts for the password, and a prompt nobody can see is a hang.
    spawnSync('sudo', step.argv, { stdio: 'inherit' });
  }

  process.stdout.write(done('removed', dim(`${BARE_ORIGIN} no longer answers`)));
}
