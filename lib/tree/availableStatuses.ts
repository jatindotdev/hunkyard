import type { GitStatus } from '@pierre/trees';

import type { FileTreeSource } from '@/lib/types';

// Returns the set of GitStatus values that are actually present in the source.
// Paths not listed in gitStatus are treated as 'modified'.
export function getFileTreeAvailableStatuses(
  source: FileTreeSource
): Set<GitStatus> {
  const statuses = new Set<GitStatus>(source.gitStatus.map((e) => e.status));
  const pathsWithExplicitStatus = new Set(source.gitStatus.map((e) => e.path));
  if (source.paths.some((p) => !pathsWithExplicitStatus.has(p))) {
    statuses.add('modified');
  }
  return statuses;
}
