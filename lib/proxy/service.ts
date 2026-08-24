// Registering hunkyard.localhost as a URL, which is the only privileged thing
// hunkyard does.
//
// Nothing of ours runs as root. launchd binds port 80 -- the one part that
// needs privilege -- before starting anything, and hands the bound socket to a
// process running as you. `RunAtLoad` is off, so that process is started by the
// first connection rather than at login: between reviews there is nothing
// running at all, and the URL still answers because the socket outlives us.

import { userInfo } from 'node:os';

import { SOCKET_NAME } from '../service/activation';

// Named for what it is, so it cannot be confused with the login agent's own
// label in lib/service/agent.ts.
export const PROXY_LABEL = 'app.hunkyard.proxy';
export const BARE_PORT = 80;

export type ServicePlatform = 'darwin' | 'linux' | 'unsupported';

export function servicePlatform(platform = process.platform): ServicePlatform {
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  // Windows has no privileged-port concept, so the bare URL works without any
  // of this and there is nothing to install.
  return 'unsupported';
}

export function launchdPlistPath(): string {
  return `/Library/LaunchDaemons/${PROXY_LABEL}.plist`;
}

export function systemdUnitPath(): string {
  return `/etc/systemd/system/${PROXY_LABEL}.service`;
}

// A launchd agent inherits a minimal PATH, and this server spawns git for
// everything. Without these two directories a Homebrew git is simply not there,
// and every diff fails with something that reads like a bug in hunkyard.
const SERVICE_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');

export function launchdPlist(
  executable: string,
  user = userInfo().username
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PROXY_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${executable}</string>
    <string>serve</string>
    <string>--activated</string>
  </array>
  <!-- launchd binds the socket as root, then runs this as you. Nothing of ours
       is ever privileged, and port 80 is bound by something that is. -->
  <key>UserName</key>
  <string>${user}</string>
  <!-- Off deliberately: the first connection is what starts it, so nothing runs
       between reviews. -->
  <key>RunAtLoad</key>
  <false/>
  <key>Sockets</key>
  <dict>
    <key>${SOCKET_NAME}</key>
    <dict>
      <key>SockNodeName</key>
      <string>127.0.0.1</string>
      <key>SockServiceName</key>
      <string>${BARE_PORT}</string>
      <key>SockFamily</key>
      <string>IPv4</string>
    </dict>
  </dict>
  <key>StandardOutPath</key>
  <string>${logPath(user)}</string>
  <key>StandardErrorPath</key>
  <string>${logPath(user)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${SERVICE_PATH}</string>
  </dict>
</dict>
</plist>
`;
}

// Where a process with no terminal says why it failed to start.
export function logPath(user = userInfo().username): string {
  return process.platform === 'darwin'
    ? `/Users/${user}/Library/Application Support/hunkyard/server.log`
    : `/home/${user}/.local/state/hunkyard/server.log`;
}

// systemd's half is two units: a socket it binds and holds, and the service it
// starts when that socket sees a connection.
export function systemdSocketUnit(): string {
  return `[Unit]
Description=hunkyard on port ${BARE_PORT}

[Socket]
ListenStream=127.0.0.1:${BARE_PORT}

[Install]
WantedBy=sockets.target
`;
}

export function systemdUnit(
  executable: string,
  user = userInfo().username
): string {
  return `[Unit]
Description=hunkyard review server
Requires=${PROXY_LABEL}.socket

[Service]
ExecStart=${executable} serve --activated
User=${user}
Environment=PATH=${SERVICE_PATH}
# The socket unit restarts it on the next connection, so exiting when idle is
# the design rather than a failure.
Restart=no
`;
}

export function systemdSocketPath(): string {
  return `/etc/systemd/system/${PROXY_LABEL}.socket`;
}
