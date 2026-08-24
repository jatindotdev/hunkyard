import { dirname, resolve, sep } from 'node:path';

// Confines the browser to one subtree. Unset by default: there is no blocklist
// either, because the server runs as you and can already read whatever you can.
// It exists for someone who wants the daemon's reach narrowed deliberately.
export const BROWSE_ROOT_ENV = 'HUNKYARD_BROWSE_ROOT';

// The caller named something that is not a path we will ever look at.
export class InvalidBrowsePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBrowsePathError';
  }
}

export class BrowsePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowsePermissionError';
  }
}

export class BrowseNotFoundError extends Error {
  constructor(path: string) {
    super(`${path} does not exist.`);
    this.name = 'BrowseNotFoundError';
  }
}

export function browseRoot(): string | null {
  const configured = process.env[BROWSE_ROOT_ENV];
  if (configured == null || configured.trim() === '') return null;
  return resolve(configured.trim());
}

// A relative path would be resolved against wherever the daemon happens to have
// been started, which is nobody's intent, and a NUL truncates the string inside
// the syscall rather than failing.
export function assertBrowsePath(path: string): string {
  if (path.includes('\0')) {
    throw new InvalidBrowsePathError('A path cannot contain a NUL byte.');
  }
  if (!isAbsolute(path)) {
    throw new InvalidBrowsePathError(`${path} is not an absolute path.`);
  }
  return resolve(path);
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/');
}

function normaliseTrailingSeparator(path: string): string {
  return path.length > 1 && path.endsWith(sep) ? path.slice(0, -1) : path;
}

// Whether a resolved path is the root or below it. String prefixes alone would
// let `/srv/repos-private` pass for a root of `/srv/repos`, so the separator is
// part of the comparison.
export function isWithinRoot(path: string, root: string | null): boolean {
  if (root == null) return true;
  const normalised = normaliseTrailingSeparator(path);
  const base = normaliseTrailingSeparator(root);
  return normalised === base || normalised.startsWith(`${base}${sep}`);
}

// The directory to go up to, or null when there is nowhere further: the
// filesystem root, or the configured browse root, whichever comes first.
export function parentOf(path: string, root: string | null = null): string | null {
  const normalised = normaliseTrailingSeparator(path);
  if (root != null && normaliseTrailingSeparator(root) === normalised) {
    return null;
  }
  const parent = dirname(normalised);
  return parent === normalised ? null : parent;
}
