import { describe, expect, test } from 'bun:test';

import {
  AGENT_LABEL,
  agentInstallState,
  agentPlatform,
  launchAgentPath,
  launchAgentPlist,
  systemdUserUnit,
  systemdUserUnitPath,
} from '@/lib/service/agent';
import { PROXY_LABEL } from '@/lib/proxy/service';

describe('launchAgentPlist', () => {
  const plist = launchAgentPlist('/usr/local/bin/hunk', 4900, '/tmp/hunk.log');

  test('runs `serve` with the port as an argument', () => {
    expect(plist).toContain('<string>serve</string>');
    expect(plist).toContain('<string>--port</string>');
    expect(plist).toContain('<string>4900</string>');
  });

  // A plain KeepAlive restarts within seconds of `hunk stop`, with nothing to
  // say why the server came back.
  test('restarts a crash but leaves a clean exit alone', () => {
    expect(plist).toContain('<key>SuccessfulExit</key>');
    expect(plist).toContain('<false/>');
  });

  // An agent has no terminal, so "it did not start at login" is otherwise
  // undiagnosable.
  test('writes its output somewhere readable', () => {
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('/tmp/hunk.log');
  });

  // launchd hands an agent a minimal PATH, and this server spawns git for
  // everything. This is the likeliest install-time failure.
  test('carries a PATH that can find git', () => {
    expect(plist).toContain('/opt/homebrew/bin');
    expect(plist).toContain('/usr/local/bin');
  });
});

describe('systemdUserUnit', () => {
  const unit = systemdUserUnit('/usr/local/bin/hunk', 4900);

  test('runs the same command', () => {
    expect(unit).toContain('ExecStart=/usr/local/bin/hunk serve --port 4900');
  });

  test('restarts on failure only, so `hunk stop` sticks', () => {
    expect(unit).toContain('Restart=on-failure');
  });
});

describe('labels', () => {
  // The two services are installed by one command and do entirely different
  // things, one as root and one as you.
  test('the agent and the forwarder are not the same service', () => {
    expect(AGENT_LABEL).not.toBe(PROXY_LABEL);
  });

  test('each lives where its privileges belong', () => {
    expect(launchAgentPath('/Users/x')).toBe(
      `/Users/x/Library/LaunchAgents/${AGENT_LABEL}.plist`
    );
    expect(systemdUserUnitPath('/home/x')).toContain('/home/x/.config/systemd/user/');
  });
});

describe('agentInstallState', () => {
  test('reports nothing installed on a platform with no agents', async () => {
    expect(await agentInstallState('unsupported')).toMatchObject({
      installed: false,
      port: null,
    });
  });

  test('knows which platforms have one', () => {
    expect(agentPlatform('darwin')).toBe('darwin');
    expect(agentPlatform('linux')).toBe('linux');
    expect(agentPlatform('win32')).toBe('unsupported');
  });
});
