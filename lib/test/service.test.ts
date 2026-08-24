import { describe, expect, test } from 'bun:test';

import {
  BARE_PORT,
  PROXY_LABEL,
  launchdPlist,
  servicePlatform,
  systemdUnit,
} from '@/lib/proxy/service';

describe('servicePlatform', () => {
  test('recognises the two that have privileged ports', () => {
    expect(servicePlatform('darwin')).toBe('darwin');
    expect(servicePlatform('linux')).toBe('linux');
  });

  // Windows has no privileged-port concept, so the bare URL needs nothing
  // installed and there is nothing to write.
  test('has nothing to install on Windows', () => {
    expect(servicePlatform('win32')).toBe('unsupported');
  });
});

describe('the service definitions', () => {
  test('run the binary in forward mode, from 80 to the server', () => {
    const plist = launchdPlist('/usr/local/bin/hunk', 4865);
    expect(plist).toContain('<string>/usr/local/bin/hunk</string>');
    expect(plist).toContain('<string>forward</string>');
    expect(plist).toContain(`<string>${BARE_PORT}</string>`);
    expect(plist).toContain('<string>4865</string>');
    expect(plist).toContain(PROXY_LABEL);
  });

  // A forwarder that stops forwarding is worse than one never installed: the
  // URL would work until it quietly did not.
  test('are set to start at boot and be restarted', () => {
    expect(launchdPlist('/x/hunk')).toContain('<key>KeepAlive</key>');
    expect(launchdPlist('/x/hunk')).toContain('<key>RunAtLoad</key>');
    expect(systemdUnit('/x/hunk')).toContain('Restart=always');
    expect(systemdUnit('/x/hunk')).toContain('WantedBy=multi-user.target');
  });

  test('the systemd unit names the same ports', () => {
    expect(systemdUnit('/x/hunk', 4900)).toContain(
      `ExecStart=/x/hunk forward --from ${BARE_PORT} --to 4900`
    );
  });
});
