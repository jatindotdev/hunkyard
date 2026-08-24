import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  BARE_PORT,
  PROXY_LABEL,
  launchdPlist,
  launchdPlistPath,
  servicePlatform,
  systemdUnit,
  systemdUnitPath,
} from '../lib/proxy/service';
import {
  AGENT_LABEL,
  agentPlatform,
  launchAgentPath,
  launchAgentPlist,
  systemdUserUnit,
  systemdUserUnitPath,
} from '../lib/service/agent';
import { stateDir } from '../lib/repos/stateDir';
import { isCompiledBinary } from './cli-core';

function fail(message: string, hint?: string): never {
  process.stderr.write(`hunk: ${message}\n`);
  if (hint != null) process.stderr.write(`\n${hint}\n`);
  process.exit(1);
}

// The executable to run as the service. A compiled binary is its own path; run
// from a checkout there is no stable path to install, and installing a service
// that points at a temp file would break on the next build.
function serviceExecutable(): string {
  if (!isCompiledBinary()) {
    fail(
      'installing needs the compiled binary',
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
  for (const step of steps) {
    const result = spawnSync('sudo', step, { stdio: 'inherit' });
    if (result.status !== 0) {
      await unlink(staged).catch(() => undefined);
      fail(`\`sudo ${step.join(' ')}\` failed`);
    }
  }
  await unlink(staged).catch(() => undefined);
}

async function writeUserFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

function run(command: string, args: string[]): void {
  spawnSync(command, args, { stdio: 'inherit' });
}

// The login agent: unprivileged, in your own home, so it needs no sudo.
async function installAgent(port: number): Promise<void> {
  const platform = agentPlatform();
  const executable = serviceExecutable();
  await mkdir(stateDir(), { recursive: true });

  if (platform === 'darwin') {
    const path = launchAgentPath();
    await writeUserFile(path, launchAgentPlist(executable, port));
    const domain = `gui/${process.getuid?.() ?? ''}`;
    // bootout first, so reinstalling picks up the new plist rather than
    // leaving the old one loaded.
    run('launchctl', ['bootout', domain, path]);
    run('launchctl', ['bootstrap', domain, path]);
    return;
  }

  const path = systemdUserUnitPath();
  await writeUserFile(path, systemdUserUnit(executable, port));
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', `${AGENT_LABEL}.service`]);
}

async function uninstallAgent(): Promise<void> {
  const platform = agentPlatform();
  if (platform === 'darwin') {
    const path = launchAgentPath();
    run('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}`, path]);
    await unlink(path).catch(() => undefined);
    return;
  }
  if (platform === 'linux') {
    run('systemctl', ['--user', 'disable', '--now', `${AGENT_LABEL}.service`]);
    await unlink(systemdUserUnitPath()).catch(() => undefined);
  }
}

export interface InstallOptions {
  port: number;
  // The bare URL needs a listener on port 80, which needs root. Opting out
  // leaves the login agent, and hunkyard on its own port.
  bareUrl: boolean;
}

export async function installService(options: InstallOptions): Promise<void> {
  const platform = servicePlatform();

  if (platform === 'unsupported') {
    process.stdout.write(
      'Windows has no privileged-port concept, so nothing is installed here.\n' +
        `The bare URL would need the server itself on port ${BARE_PORT}, which is\n` +
        'not supported yet. hunk still serves on its own port.\n'
    );
    return;
  }

  if (options.bareUrl) {
    process.stdout.write(
      `Installing two things:\n` +
        `  a login agent, so the server is there without starting it (no sudo)\n` +
        `  a forwarder from port ${BARE_PORT}, so the URL needs no port (one sudo)\n\n` +
        `Run \`hunk install --no-bare-url\` to skip the second and the sudo.\n\n`
    );
  }

  await installAgent(options.port);
  process.stdout.write(
    `The server now starts at login and serves on port ${options.port}.\n`
  );

  if (!options.bareUrl) {
    process.stdout.write(
      `\nhttp://hunkyard.localhost:${options.port} is the URL. Run \`hunk install\`\n` +
        'without --no-bare-url to drop the port.\n'
    );
    return;
  }

  const executable = serviceExecutable();
  if (platform === 'darwin') {
    await installPrivileged(
      launchdPlist(executable, options.port),
      launchdPlistPath(),
      [
        ['launchctl', 'bootout', 'system', launchdPlistPath()],
        ['launchctl', 'bootstrap', 'system', launchdPlistPath()],
      ]
    );
  } else {
    await installPrivileged(
      systemdUnit(executable, options.port),
      systemdUnitPath(),
      [
        ['systemctl', 'daemon-reload'],
        ['systemctl', 'enable', '--now', `${PROXY_LABEL}.service`],
      ]
    );
  }

  process.stdout.write(`\nhttp://hunkyard.localhost is now the URL.\n`);
}

export async function uninstallService(): Promise<void> {
  const platform = servicePlatform();

  await uninstallAgent();
  process.stdout.write('Removed the login agent.\n');

  if (platform === 'unsupported') return;

  const steps: string[][] =
    platform === 'darwin'
      ? [
          ['launchctl', 'bootout', 'system', launchdPlistPath()],
          ['rm', '-f', launchdPlistPath()],
        ]
      : [
          ['systemctl', 'disable', '--now', `${PROXY_LABEL}.service`],
          ['rm', '-f', systemdUnitPath()],
        ];

  process.stdout.write('Removing the forwarder. This needs sudo, once.\n');
  for (const step of steps) {
    // bootout fails when it was not loaded, which is not an error here: the
    // point is to end up with it gone.
    spawnSync('sudo', step, { stdio: 'inherit' });
  }
  process.stdout.write(
    `\nPort ${BARE_PORT} is no longer forwarded, and nothing starts at login.\n`
  );
}
