import { describe, expect, test } from 'bun:test';

import {
  BARE_PORT,
  PROXY_LABEL,
  launchdPlist,
  isSupportedPlatform,
  servicePlatform,
  systemdSocketUnit,
  systemdUnit,
} from '@/lib/proxy/service';
import { SOCKET_NAME } from '@/lib/service/activation';

describe('the supported platforms', () => {
  test('are the two whose service managers hand over a bound socket', () => {
    expect(servicePlatform('darwin')).toBe('darwin');
    expect(servicePlatform('linux')).toBe('linux');
    expect(isSupportedPlatform('darwin')).toBe(true);
    expect(isSupportedPlatform('linux')).toBe(true);
  });

  test('and nothing else', () => {
    expect(isSupportedPlatform('win32')).toBe(false);
    expect(isSupportedPlatform('freebsd')).toBe(false);
  });
});

describe('the launchd job', () => {
  const plist = launchdPlist('/usr/local/bin/hunk', 'someone');

  test('runs the binary in activated mode', () => {
    expect(plist).toContain('<string>/usr/local/bin/hunk</string>');
    expect(plist).toContain('<string>service</string>');
    expect(plist).toContain('<string>run</string>');
    expect(plist).toContain('<string>--activated</string>');
    expect(plist).toContain(PROXY_LABEL);
  });

  // The whole point: launchd binds the privileged port, and what it starts runs
  // as the user. Nothing of ours is ever root.
  test('binds port 80 but runs as the user', () => {
    expect(plist).toContain('<key>UserName</key>');
    expect(plist).toContain('<string>someone</string>');
    expect(plist).toContain(`<string>${BARE_PORT}</string>`);
  });

  // RunAtLoad true would be a server running from login whether or not anyone
  // wants one, which is exactly what socket activation is here to avoid.
  test('is started by a connection rather than at login', () => {
    expect(plist).toContain('<key>RunAtLoad</key>\n  <false/>');
    expect(plist).not.toContain('<key>KeepAlive</key>');
  });

  // launchd hands the socket over by the name the plist gave it, so the two
  // have to agree or it answers with nothing.
  test('names the socket the same thing the code asks for', () => {
    expect(plist).toContain(`<key>${SOCKET_NAME}</key>`);
  });

  // launchd gives a job a minimal PATH, and this server spawns git for
  // everything.
  test('carries a PATH that can find git', () => {
    expect(plist).toContain('/opt/homebrew/bin');
    expect(plist).toContain('/usr/local/bin');
  });
});

describe('the systemd units', () => {
  test('the socket unit holds the port', () => {
    expect(systemdSocketUnit()).toContain(`ListenStream=127.0.0.1:${BARE_PORT}`);
    expect(systemdSocketUnit()).toContain('WantedBy=sockets.target');
  });

  test('the service runs as the user, in activated mode', () => {
    const unit = systemdUnit('/x/hunk', 'someone');
    expect(unit).toContain('ExecStart=/x/hunk service run --activated');
    expect(unit).toContain('User=someone');
    expect(unit).toContain(`Requires=${PROXY_LABEL}.socket`);
  });

  // Exiting when idle is the design, so restarting on exit would fight it.
  test('does not restart itself when it exits', () => {
    expect(systemdUnit('/x/hunk', 'someone')).toContain('Restart=no');
  });
});
