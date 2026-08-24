// The login agent that keeps the server there without anyone starting it.
//
// Unprivileged, unlike the port-80 forwarder in lib/proxy/service.ts: this one
// runs as you, in your own LaunchAgents directory. The two are installed
// together by `hunk install` and are otherwise unrelated.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { stateDir } from '../repos/stateDir';
import { DEFAULT_PORT } from '../../server/index';

export const AGENT_LABEL = 'app.hunkyard.server';

export type AgentPlatform = 'darwin' | 'linux' | 'unsupported';

export function agentPlatform(platform = process.platform): AgentPlatform {
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  return 'unsupported';
}

export function launchAgentPath(home = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);
}

export function systemdUserUnitPath(home = homedir()): string {
  return join(home, '.config', 'systemd', 'user', `${AGENT_LABEL}.service`);
}

export function agentLogPath(): string {
  return join(stateDir(), 'server.log');
}

// A launchd agent inherits a minimal PATH, and this server spawns git for
// everything. Without these two directories a Homebrew git is simply not there,
// and every diff fails with something that reads like a bug in hunkyard.
const AGENT_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');

export function launchAgentPlist(
  executable: string,
  port = DEFAULT_PORT,
  logPath = agentLogPath()
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${executable}</string>
    <string>serve</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <!-- Not a plain KeepAlive: that restarts the server within seconds of
       \`hunk stop\`, with nothing to say why it came back. SuccessfulExit
       false restarts a crash and leaves a clean exit alone. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <!-- An agent has no terminal, so without this "it did not start at login"
       has nowhere to be diagnosed from. -->
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${AGENT_PATH}</string>
  </dict>
</dict>
</plist>
`;
}

export function systemdUserUnit(
  executable: string,
  port = DEFAULT_PORT
): string {
  return `[Unit]
Description=hunkyard review server
After=default.target

[Service]
ExecStart=${executable} serve --port ${port}
Environment=PATH=${AGENT_PATH}
# on-failure, not always: \`hunk stop\` exits cleanly and must stay stopped.
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export interface AgentInstallState {
  installed: boolean;
  path: string;
  // The port the installed agent serves on, which need not be the default and
  // is the only record of what was chosen at install time.
  port: number | null;
}

function portFromPlist(contents: string): number | null {
  const strings = [...contents.matchAll(/<string>([^<]*)<\/string>/g)].map(
    (match) => match[1] ?? ''
  );
  const index = strings.indexOf('--port');
  const value = index === -1 ? null : strings[index + 1];
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function portFromUnit(contents: string): number | null {
  const match = /^ExecStart=.*\s--port\s+(\d+)/m.exec(contents);
  const port = Number(match?.[1]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

// Whether the agent is installed, and on which port. File existence only: what
// launchd thinks is a separate question, and asking it costs a subprocess.
export async function agentInstallState(
  platform = agentPlatform()
): Promise<AgentInstallState> {
  if (platform === 'unsupported') {
    return { installed: false, path: '', port: null };
  }
  const path =
    platform === 'darwin' ? launchAgentPath() : systemdUserUnitPath();
  try {
    const contents = await readFile(path, 'utf8');
    return {
      installed: true,
      path,
      port: platform === 'darwin' ? portFromPlist(contents) : portFromUnit(contents),
    };
  } catch {
    return { installed: false, path, port: null };
  }
}
