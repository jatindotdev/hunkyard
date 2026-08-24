import { describe, expect, test } from 'bun:test';

import {
  assetName,
  assetUrl,
  compareVersions,
  isNewerVersion,
  normalizeVersion,
  parseChecksums,
} from '@/lib/update';

describe('assetName', () => {
  // These have to match what scripts/release.ts publishes, or the download is
  // a 404 with nothing to say why.
  test('names the asset for each published platform', () => {
    expect(assetName({ platform: 'darwin', arch: 'arm64' })).toBe(
      'hunk-darwin-arm64'
    );
    expect(assetName({ platform: 'darwin', arch: 'x64' })).toBe(
      'hunk-darwin-x64'
    );
    expect(assetName({ platform: 'linux', arch: 'arm64' })).toBe(
      'hunk-linux-arm64'
    );
    expect(assetName({ platform: 'win32', arch: 'x64' })).toBe(
      'hunk-windows-x64.exe'
    );
  });

  // musl and glibc are different libcs rather than variants of one build.
  test('picks the musl build on a musl system', () => {
    expect(assetName({ platform: 'linux', arch: 'x64', musl: true })).toBe(
      'hunk-linux-x64-musl'
    );
  });

  test('the musl suffix is linux-only', () => {
    expect(assetName({ platform: 'darwin', arch: 'arm64', musl: true })).toBe(
      'hunk-darwin-arm64'
    );
  });

  test('has nothing for a platform with no release', () => {
    expect(assetName({ platform: 'freebsd', arch: 'x64' })).toBeNull();
    expect(assetName({ platform: 'linux', arch: 'riscv64' })).toBeNull();
    // Windows publishes x64 only.
    expect(assetName({ platform: 'win32', arch: 'arm64' })).toBeNull();
  });
});

describe('assetUrl', () => {
  test('uses the latest redirect when no tag is named', () => {
    expect(assetUrl('hunk-darwin-arm64')).toBe(
      'https://github.com/jatindotdev/hunkyard/releases/latest/download/hunk-darwin-arm64'
    );
  });

  test('names the tag when there is one', () => {
    expect(assetUrl('hunk-darwin-arm64', 'v0.2.0')).toContain(
      '/releases/download/v0.2.0/'
    );
  });
});

describe('parseChecksums', () => {
  test('reads the sha256sum format the release publishes', () => {
    const digest = 'a'.repeat(64);
    const sums = parseChecksums(
      `${digest}  hunk-darwin-arm64\n${'b'.repeat(64)}  hunk-linux-x64\n`
    );
    expect(sums.get('hunk-darwin-arm64')).toBe(digest);
    expect(sums.size).toBe(2);
  });

  test('ignores anything that is not a digest and a name', () => {
    expect(parseChecksums('nonsense\n\n# a comment\n').size).toBe(0);
  });
});

describe('compareVersions', () => {
  test('compares numerically rather than as strings', () => {
    // "0.10.0" < "0.9.0" as a string, which is the classic way to ship a
    // release that never offers itself as an update.
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  test('ignores a leading v, since tags carry one and the version does not', () => {
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
  });

  test('treats a missing component as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  // A prerelease sorts before the release of the same numbers, so someone on
  // 0.2.0-rc.1 is offered 0.2.0.
  test('sorts a prerelease before its release', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBe(-1);
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBe(1);
    expect(compareVersions('0.2.0-rc.2', '0.2.0-rc.1')).toBe(1);
  });
});

describe('isNewerVersion', () => {
  test('is true only for something actually newer', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    // A binary built ahead of the latest release must not be talked backwards.
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });
});
