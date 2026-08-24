import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  assertBrowsePath,
  BrowseNotFoundError,
  BrowsePermissionError,
  browseRoot,
  InvalidBrowsePathError,
  isWithinRoot,
  parentOf,
} from './browsePath';

export interface BrowseEntry {
  name: string;
  path: string;
  // Whether this directory is itself a repository. False when probing ran out
  // of budget, which `probeIncomplete` on the listing reports.
  isRepository: boolean;
}

export interface DirectoryListing {
  // The realpath of what was listed, which is what git will call it too.
  path: string;
  parent: string | null;
  home: string;
  isRepository: boolean;
  // The nearest repository at or above this directory, so the UI can offer to
  // open the checkout you are standing inside rather than only its root.
  enclosingRepository: string | null;
  entries: BrowseEntry[];
  // More directories than the cap, after filtering.
  truncated: boolean;
  // Some entries were not probed, so their `isRepository` is a floor.
  probeIncomplete: boolean;
}

// Nobody scrolls a thousand folders, and the reply is rendered as one list.
const MAX_ENTRIES = 500;

// A single stat on an SMB or sshfs mount can block for seconds, and there is
// one per entry. The listing is worth more than the badges on it, so probing
// gives up rather than holding the whole response.
const PROBE_BUDGET_MS = 250;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

// Translates the filesystem's own errors into ones the route can map to a
// status. Anything else is a real failure and is left to propagate.
function rethrowAsBrowseError(error: unknown, path: string): never {
  if (isNodeError(error)) {
    if (error.code === 'ENOENT') throw new BrowseNotFoundError(path);
    if (error.code === 'ENOTDIR') {
      throw new InvalidBrowsePathError(`${path} is not a directory.`);
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new BrowsePermissionError(
        `${path} cannot be read. On macOS a background service does not inherit ` +
          'the Full Disk Access your terminal has, so folders like Desktop, ' +
          'Documents and Downloads stay refused until hunkyard itself is ' +
          'granted access in System Settings > Privacy & Security.'
      );
    }
  }
  throw error;
}

// A repository is a directory with a `.git`, which is a directory in an
// ordinary checkout and a file in a worktree or submodule. Spawning `git` per
// entry would be one process per row of the list.
async function isRepositoryDirectory(path: string): Promise<boolean> {
  try {
    const dotGit = await stat(join(path, '.git'));
    return dotGit.isDirectory() || dotGit.isFile();
  } catch {
    return false;
  }
}

async function nearestRepository(
  path: string,
  root: string | null
): Promise<string | null> {
  let current: string | null = path;
  while (current != null && isWithinRoot(current, root)) {
    if (await isRepositoryDirectory(current)) return current;
    current = parentOf(current, root);
  }
  return null;
}

export interface BrowseOptions {
  // Where to list. Defaults to the home directory, which is where someone
  // looking for a checkout is most likely to start.
  path?: string;
  // A case-insensitive substring, applied before the cap so filtering can reach
  // entries a truncated listing had dropped.
  filter?: string;
  hidden?: boolean;
}

export async function browseDirectory(
  options: BrowseOptions = {}
): Promise<DirectoryListing> {
  const configuredRoot = browseRoot();
  const home = homedir();
  const requested = assertBrowsePath(options.path ?? configuredRoot ?? home);

  const refuseOutsideRoot = (path: string, root: string | null) => {
    if (isWithinRoot(path, root)) return;
    throw new BrowsePermissionError(
      `Browsing is confined to ${root}, so ${path} cannot be listed.`
    );
  };
  refuseOutsideRoot(requested, configuredRoot);

  // Resolve the directory being listed, not its children: `findRepoRoot` gives
  // git's resolved path and `repoIdFor` hashes it, so listing `/tmp/x` while
  // registration produces the id for `/private/tmp/x` would give one repository
  // two identities and duplicate its recents entry.
  let path: string;
  try {
    path = await realpath(requested);
  } catch (error) {
    rethrowAsBrowseError(error, requested);
  }

  // The root is resolved the same way, or a root under a symlinked parent
  // -- which is what a temp directory is on macOS -- would never contain
  // anything, including itself.
  const root =
    configuredRoot == null
      ? null
      : await realpath(configuredRoot).catch(() => configuredRoot);
  refuseOutsideRoot(path, root);

  let dirents;
  try {
    dirents = await readdir(path, { withFileTypes: true });
  } catch (error) {
    rethrowAsBrowseError(error, path);
  }

  const wanted = options.filter?.trim().toLowerCase() ?? '';
  const deadline = Date.now() + PROBE_BUDGET_MS;
  let probeIncomplete = false;

  const candidates = dirents
    .filter((dirent) => options.hidden === true || !dirent.name.startsWith('.'))
    .filter(
      (dirent) => wanted === '' || dirent.name.toLowerCase().includes(wanted)
    )
    .filter((dirent) => dirent.isDirectory() || dirent.isSymbolicLink())
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

  const truncated = candidates.length > MAX_ENTRIES;
  const entries: BrowseEntry[] = [];

  for (const dirent of candidates.slice(0, MAX_ENTRIES)) {
    const entryPath = join(path, dirent.name);

    // A symlink is only worth showing when it points at a directory, and
    // finding that out costs the same stat as everything else here.
    if (!dirent.isDirectory()) {
      if (Date.now() >= deadline) {
        probeIncomplete = true;
        continue;
      }
      try {
        if (!(await stat(entryPath)).isDirectory()) continue;
      } catch {
        continue;
      }
    }

    if (Date.now() >= deadline) {
      probeIncomplete = true;
      entries.push({ name: dirent.name, path: entryPath, isRepository: false });
      continue;
    }

    entries.push({
      name: dirent.name,
      path: entryPath,
      isRepository: await isRepositoryDirectory(entryPath),
    });
  }

  const isRepository = await isRepositoryDirectory(path);

  return {
    path,
    parent: parentOf(path, root),
    home,
    isRepository,
    enclosingRepository: isRepository
      ? path
      : await nearestRepository(parentOf(path, root) ?? path, root),
    entries,
    truncated,
    probeIncomplete,
  };
}
