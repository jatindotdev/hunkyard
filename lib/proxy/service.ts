// Installing the forwarder as a system service, which is the only privileged
// thing hunkyard does and is entirely opt-in.
//
// Only the listener needs root, so only the listener runs as root. The server
// stays unprivileged and does not know this exists.

import { DEFAULT_PORT } from '../../server/index';

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

// RunAtLoad and KeepAlive because a forwarder that stops forwarding is worse
// than one that was never installed: the URL would work until it quietly did
// not.
export function launchdPlist(executable: string, to = DEFAULT_PORT): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PROXY_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${executable}</string>
    <string>forward</string>
    <string>--from</string>
    <string>${BARE_PORT}</string>
    <string>--to</string>
    <string>${to}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

export function systemdUnit(executable: string, to = DEFAULT_PORT): string {
  return `[Unit]
Description=hunkyard port ${BARE_PORT} forwarder
After=network.target

[Service]
ExecStart=${executable} forward --from ${BARE_PORT} --to ${to}
Restart=always

[Install]
WantedBy=multi-user.target
`;
}
