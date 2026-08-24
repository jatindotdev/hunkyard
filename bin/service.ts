import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
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
import { BARE_ORIGIN, probeBareUrl } from '../lib/proxy/canonical';
import { stateDir } from '../lib/repos/stateDir';
import { isCompiledBinary } from './cli-core';
import { bold, cyan, dim, errorPrefix, green } from './style';

function fail(message: string, hint?: string): never {
  process.stderr.write(`${errorPrefix()} ${message}\n`);
  if (hint != null) process.stderr.write(`\n${dim(hint)}\n`);
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

  // The staging move goes first, and it is never tolerated, so it is the step
  // that prompts for the password. Anything silenced below therefore runs
  // against a fresh sudo timestamp -- silencing a step that still needed to
  // prompt would be a hang with nothing on screen.
  const steps: Step[] = [
    { argv: ['install', '-m', '0644', '-o', 'root', staged, destination] },
    ...after,
  ];
  for (const step of steps) {
    const result = spawnSync('sudo', step.argv, {
      // A tolerated step's failure is expected, and launchd narrates it
      // (`Boot-out failed: 5: Input/output error`) in a way that reads like
      // something went wrong. Its output is swallowed rather than explained.
      stdio: step.tolerated === true ? 'ignore' : 'inherit',
    });
    if (result.status !== 0 && step.tolerated !== true) {
      await unlink(staged).catch(() => undefined);
      fail(`\`sudo ${step.argv.join(' ')}\` failed`);
    }
  }
  await unlink(staged).catch(() => undefined);
}

// One shape for every outcome line, so install and uninstall read alike.
function done(label: string, detail: string): string {
  return `  ${green('✓')} ${label.padEnd(17)} ${detail}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function writeUserFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

// Whether the file already says exactly what we would write. Comparing the
// contents rather than merely the path is what catches an install whose port
// changed, or whose binary has since moved.
async function alreadyWritten(
  path: string,
  contents: string
): Promise<boolean> {
  try {
    return (await readFile(path, 'utf8')) === contents;
  } catch {
    return false;
  }
}

// Whether launchd or systemd is running the agent right now, as opposed to
// merely having a file for it. Both answer without sudo, since it is the user's
// own domain.
function agentLoaded(): boolean {
  const platform = agentPlatform();
  if (platform === 'darwin') {
    return (
      spawnSync(
        'launchctl',
        ['print', `gui/${process.getuid?.() ?? ''}/${AGENT_LABEL}`],
        { stdio: 'ignore' }
      ).status === 0
    );
  }
  if (platform === 'linux') {
    return (
      spawnSync('systemctl', ['--user', 'is-active', '--quiet', `${AGENT_LABEL}.service`], {
        stdio: 'ignore',
      }).status === 0
    );
  }
  return false;
}

// The forwarder answers only when something is serving behind it, so this waits
// for the server the agent just started rather than asking immediately.
async function serverAnswers(port: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        const body = (await response.json()) as { app?: string };
        if (body.app === 'hunkyard') return true;
      }
    } catch {
      // Not up yet, or not up at all.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Unprivileged, so no sudo, but the same rule about which failures count: a
// bootout with nothing loaded is fine, a bootstrap that fails means the agent
// is not there and saying so beats reporting success.
function run(
  command: string,
  args: string[],
  options: { tolerated?: boolean } = {}
): void {
  const result = spawnSync(command, args, {
    stdio: options.tolerated === true ? 'ignore' : 'inherit',
  });
  if (result.status !== 0 && options.tolerated !== true) {
    fail(
      `\`${command} ${args.join(' ')}\` failed`,
      'The server can still be started with `hunk`; it just will not start on its own.'
    );
  }
}

// The login agent: unprivileged, in your own home, so it needs no sudo.
// Returns whether anything was actually changed.
async function installAgent(
  port: number,
  stopServer: () => Promise<void>
): Promise<boolean> {
  const platform = agentPlatform();
  const executable = serviceExecutable();
  const darwin = platform === 'darwin';
  const path = darwin ? launchAgentPath() : systemdUserUnitPath();
  const contents = darwin
    ? launchAgentPlist(executable, port)
    : systemdUserUnit(executable, port);

  if ((await alreadyWritten(path, contents)) && agentLoaded()) return false;

  await mkdir(stateDir(), { recursive: true });
  await writeUserFile(path, contents);

  // The agent binds this port the moment it is bootstrapped, and a server
  // started by hand is holding it. Without clearing the way, launchd starts the
  // agent, watches it fail to bind, and restarts it forever.
  await stopServer();

  if (darwin) {
    const domain = `gui/${process.getuid?.() ?? ''}`;
    // bootout first, so reinstalling picks up the new plist rather than
    // leaving the old one loaded. Nothing is loaded on a first install.
    run('launchctl', ['bootout', domain, path], { tolerated: true });
    run('launchctl', ['bootstrap', domain, path]);
    return true;
  }

  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', `${AGENT_LABEL}.service`]);
  return true;
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
  // Stops a server started by hand, so the agent can bind the port. Supplied by
  // the CLI, which owns the pid file and the health check.
  stopServer(): Promise<void>;
}

// Running this twice must be the same as running it once, and the second run
// must not ask for a password to do nothing. So each half is compared against
// what is already there -- the file's contents, not merely its path, and
// whether the thing is actually loaded -- and skipped when it matches.
export async function installService(options: InstallOptions): Promise<void> {
  const { port } = options;
  const platform = servicePlatform();

  if (platform === 'unsupported') {
    process.stdout.write(
      `${dim('Windows has no privileged-port concept, so there is nothing to install.')}\n` +
        `hunk still serves on ${cyan(`http://hunkyard.localhost:${port}`)}.\n`
    );
    return;
  }

  const executable = serviceExecutable();
  const forwarder = platform === 'darwin'
    ? { path: launchdPlistPath(), contents: launchdPlist(executable, port) }
    : { path: systemdUnitPath(), contents: systemdUnit(executable, port) };

  // Asked before anything is changed, so a run that has nothing to do says so
  // without a sudo prompt. The forwarder only answers when a server is behind
  // it, hence the wait rather than an immediate probe.
  const agentWasCurrent =
    (await alreadyWritten(
      platform === 'darwin' ? launchAgentPath() : systemdUserUnitPath(),
      platform === 'darwin'
        ? launchAgentPlist(executable, port)
        : systemdUserUnit(executable, port)
    )) && agentLoaded();
  const forwarderWasCurrent =
    agentWasCurrent &&
    (await alreadyWritten(forwarder.path, forwarder.contents)) &&
    (await serverAnswers(port)) &&
    (await probeBareUrl(port));

  if (agentWasCurrent && forwarderWasCurrent) {
    process.stdout.write(
      done('already installed', bold(cyan(BARE_ORIGIN)))
    );
    return;
  }

  // Only the forwarder needs root. A password prompt that arrives unannounced
  // is the thing worth a line of its own; when there is no prompt coming, there
  // is nothing to announce.
  if (!forwarderWasCurrent) {
    process.stdout.write(
      `Installing. The port ${BARE_PORT} forwarder needs ${bold('sudo')}, once.\n\n`
    );
  }

  await installAgent(port, options.stopServer);

  if (!forwarderWasCurrent) {
    await installPrivileged(
      forwarder.contents,
      forwarder.path,
      platform === 'darwin'
        ? [
            // Unloading first is what makes reinstalling pick up a new plist,
            // and on a first install there is nothing to unload.
            { argv: ['launchctl', 'bootout', 'system', forwarder.path], tolerated: true },
            { argv: ['launchctl', 'bootstrap', 'system', forwarder.path] },
          ]
        : [
            { argv: ['systemctl', 'daemon-reload'] },
            { argv: ['systemctl', 'enable', '--now', `${PROXY_LABEL}.service`] },
          ]
    );
  }

  process.stdout.write(
    done('login agent', dim(`port ${port}, at login`)) +
      done('port 80 forwarder', bold(cyan(BARE_ORIGIN)))
  );
}

export async function uninstallService(): Promise<void> {
  const platform = servicePlatform();
  const agentPath =
    agentPlatform() === 'darwin' ? launchAgentPath() : systemdUserUnitPath();
  const forwarderPath =
    platform === 'darwin' ? launchdPlistPath() : systemdUnitPath();

  // Removing what was never installed is the outcome we want, so it succeeds --
  // but it should not ask for a password to achieve nothing.
  const hasAgent = await exists(agentPath);
  const hasForwarder = platform !== 'unsupported' && (await exists(forwarderPath));
  if (!hasAgent && !hasForwarder) {
    process.stdout.write(`${dim('Nothing to remove.')}\n`);
    return;
  }

  if (hasAgent) await uninstallAgent();

  if (platform === 'unsupported' || !hasForwarder) {
    process.stdout.write(done('removed', dim('nothing starts at login')));
    return;
  }

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

  process.stdout.write(
    `Removing. The port ${BARE_PORT} forwarder needs ${bold('sudo')}, once.\n\n`
  );
  for (const step of steps) {
    // bootout fails when it was not loaded, which is not an error here: the
    // point is to end up with it gone. Output is inherited rather than
    // swallowed because the first of these is what prompts for the password,
    // and a prompt nobody can see is a hang.
    spawnSync('sudo', step, { stdio: 'inherit' });
  }
  process.stdout.write(
    done('removed', dim(`nothing starts at login, port ${BARE_PORT} is free`))
  );
}
