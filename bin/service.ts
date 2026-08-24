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

// A step that is allowed to fail, because there is a state in which failing is
// the correct outcome. Unloading something that was never loaded is the whole
// of that category: launchd answers `Boot-out failed: 5: Input/output error`,
// and on a first install that is simply what "not loaded" sounds like.
interface Step {
  argv: string[];
  tolerated?: boolean;
}

// Writes a root-owned file by staging it somewhere writable and moving it with
// sudo, so the password prompt happens once and nothing else runs privileged.
async function installPrivileged(
  contents: string,
  destination: string,
  after: Step[]
): Promise<void> {
  const staged = join(await mkdtemp(join(tmpdir(), 'hunk-service-')), 'unit');
  await writeFile(staged, contents);

  const steps: Step[] = [
    { argv: ['install', '-m', '0644', '-o', 'root', staged, destination] },
    ...after,
  ];
  for (const step of steps) {
    const result = spawnSync('sudo', step.argv, { stdio: 'inherit' });
    if (result.status !== 0 && step.tolerated !== true) {
      await unlink(staged).catch(() => undefined);
      fail(`\`sudo ${step.argv.join(' ')}\` failed`);
    }
  }
  await unlink(staged).catch(() => undefined);
}

async function writeUserFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

// Unprivileged, so no sudo, but the same rule about which failures count: a
// bootout with nothing loaded is fine, a bootstrap that fails means the agent
// is not there and saying so beats reporting success.
function run(
  command: string,
  args: string[],
  options: { tolerated?: boolean } = {}
): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0 && options.tolerated !== true) {
    fail(
      `\`${command} ${args.join(' ')}\` failed`,
      'The server can still be started with `hunk`; it just will not start on its own.'
    );
  }
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
    // leaving the old one loaded. Nothing is loaded on a first install.
    run('launchctl', ['bootout', domain, path], { tolerated: true });
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
  // Every step here is tolerated: the point is to end up with it gone, and
  // uninstalling what was never installed is a success, not an error.
  if (platform === 'darwin') {
    const path = launchAgentPath();
    run('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}`, path], {
      tolerated: true,
    });
    await unlink(path).catch(() => undefined);
    return;
  }
  if (platform === 'linux') {
    run('systemctl', ['--user', 'disable', '--now', `${AGENT_LABEL}.service`], {
      tolerated: true,
    });
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
        // Unloading first is what makes reinstalling pick up a new plist, and
        // on a first install there is nothing to unload.
        { argv: ['launchctl', 'bootout', 'system', launchdPlistPath()], tolerated: true },
        { argv: ['launchctl', 'bootstrap', 'system', launchdPlistPath()] },
      ]
    );
  } else {
    await installPrivileged(
      systemdUnit(executable, options.port),
      systemdUnitPath(),
      [
        { argv: ['systemctl', 'daemon-reload'] },
        { argv: ['systemctl', 'enable', '--now', `${PROXY_LABEL}.service`] },
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
