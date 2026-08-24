// Working out what to download, and whether it is worth downloading.
//
// Kept apart from the command so the naming and the version comparison can be
// tested without reaching the network or replacing anything on disk.

export const RELEASE_REPO = 'jatindotdev/hunkyard';

export type UpdatePlatform = 'darwin' | 'linux' | 'win32';

// The asset names the release build produces, from scripts/release.ts. A name
// that does not match one of those is a download that 404s, so the mapping is
// written the same way in both places rather than guessed at.
export function assetName(options: {
  platform: string;
  arch: string;
  musl?: boolean;
}): string | null {
  const os =
    options.platform === 'darwin'
      ? 'darwin'
      : options.platform === 'linux'
        ? 'linux'
        : options.platform === 'win32'
          ? 'windows'
          : null;
  if (os == null) return null;

  const arch =
    options.arch === 'arm64'
      ? 'arm64'
      : options.arch === 'x64'
        ? 'x64'
        : null;
  if (arch == null) return null;

  // Windows ships x64 only, and with an extension.
  if (os === 'windows') return arch === 'x64' ? 'hunk-windows-x64.exe' : null;

  // musl and glibc are different libcs rather than variants of one build, so
  // Alpine and friends need their own binary.
  const suffix = os === 'linux' && options.musl === true ? '-musl' : '';
  return `hunk-${os}-${arch}${suffix}`;
}

export function assetUrl(asset: string, tag?: string): string {
  const base =
    tag == null || tag === ''
      ? `https://github.com/${RELEASE_REPO}/releases/latest/download`
      : `https://github.com/${RELEASE_REPO}/releases/download/${tag}`;
  return `${base}/${asset}`;
}

export function latestReleaseUrl(): string {
  return `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
}

// `<digest>  <name>` per line, which is what sha256sum writes and what
// scripts/release.ts produces.
export function parseChecksums(text: string): Map<string, string> {
  const digests = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(line.trim());
    if (match?.[1] != null && match[2] != null) {
      digests.set(match[2], match[1]);
    }
  }
  return digests;
}

// Releases are tagged `v0.1.0`, and the version compiled in is `0.1.0`.
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '');
}

// Enough of semver for "is the release newer than what is running". A
// prerelease sorts before the release of the same numbers, which is the one
// rule that is not just numeric comparison.
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = '', pre = ''] = normalizeVersion(version).split('-', 2);
    return {
      numbers: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre,
    };
  };
  const left = parse(a);
  const right = parse(b);

  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }

  if (left.pre === right.pre) return 0;
  if (left.pre === '') return 1;
  if (right.pre === '') return -1;
  return left.pre < right.pre ? -1 : 1;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
