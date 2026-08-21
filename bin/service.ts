import { spawnSync } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BARE_PORT,
  SERVICE_LABEL,
  launchdPlist,
  launchdPlistPath,
  servicePlatform,
  systemdUnit,
  systemdUnitPath,
} from '../lib/proxy/service';

function fail(message: string, hint?: string): never {
  process.stderr.write(`hunk: ${message}\n`);
  if (hint != null) process.stderr.write(`\n${hint}\n`);
  process.exit(1);
}

// The executable to run as the service. A compiled binary is its own path; run
// from a checkout there is no stable path to install, and installing a service
// that points at a temp file would break on the next build.
function serviceExecutable(): string {
  if (!import.meta.path.startsWith('/$bunfs/')) {
    fail(
      'installing the service needs the compiled binary',
      'Run `bun run build` and use dist/hunk, or install a release.'
    );
  }
  return process.execPath;
}

// Writes a root-owned file by staging it somewhere writable and moving it with
// sudo, so the password prompt happens once and nothing else runs privileged.
async function installPrivileged(
  contents: string,
  destination: string,
  after: string[][]
): Promise<void> {
  const staged = join(await mkdtemp(join(tmpdir(), 'hunk-service-')), 'unit');
  await writeFile(staged, contents);

  const steps: string[][] = [
    ['install', '-m', '0644', '-o', 'root', staged, destination],
    ...after,
  ];
  process.stdout.write(
    `Installing ${destination}. This needs sudo, once.\n`
  );
  for (const step of steps) {
    const result = spawnSync('sudo', step, { stdio: 'inherit' });
    if (result.status !== 0) {
      await unlink(staged).catch(() => undefined);
      fail(`\`sudo ${step.join(' ')}\` failed`);
    }
  }
  await unlink(staged).catch(() => undefined);
}

export async function installService(to: number): Promise<void> {
  const platform = servicePlatform();
  if (platform === 'unsupported') {
    process.stdout.write(
      'Windows has no privileged-port concept, so there is nothing to install.\n'
    );
    return;
  }

  const executable = serviceExecutable();
  if (platform === 'darwin') {
    await installPrivileged(launchdPlist(executable, to), launchdPlistPath(), [
      ['launchctl', 'bootout', 'system', launchdPlistPath()],
      ['launchctl', 'bootstrap', 'system', launchdPlistPath()],
    ]);
  } else {
    await installPrivileged(systemdUnit(executable, to), systemdUnitPath(), [
      ['systemctl', 'daemon-reload'],
      ['systemctl', 'enable', '--now', `${SERVICE_LABEL}.service`],
    ]);
  }

  process.stdout.write(
    `\nhttp://hunkyard.localhost now reaches port ${to}.\n` +
      'It forwards whether or not a server is running, so nothing is listening\n' +
      'until you run hunk.\n'
  );
}

export async function uninstallService(): Promise<void> {
  const platform = servicePlatform();
  if (platform === 'unsupported') {
    process.stdout.write('Nothing was installed on this platform.\n');
    return;
  }

  const steps: string[][] =
    platform === 'darwin'
      ? [
          ['launchctl', 'bootout', 'system', launchdPlistPath()],
          ['rm', '-f', launchdPlistPath()],
        ]
      : [
          ['systemctl', 'disable', '--now', `${SERVICE_LABEL}.service`],
          ['rm', '-f', systemdUnitPath()],
        ];

  process.stdout.write('Removing the forwarder. This needs sudo, once.\n');
  for (const step of steps) {
    // bootout fails when it was not loaded, which is not an error here: the
    // point is to end up with it gone.
    spawnSync('sudo', step, { stdio: 'inherit' });
  }
  process.stdout.write(
    `\nPort ${BARE_PORT} is no longer forwarded. hunk still serves on its own port.\n`
  );
}
