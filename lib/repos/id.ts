import { createHash } from 'node:crypto';
import { basename } from 'node:path';

// A short, stable, readable id for a repository root.
//
// The name alone would collide across checkouts of the same repository, and the
// path alone is unreadable in a URL. The name makes the URL legible; the hash of
// the absolute path is what actually identifies it, so two checkouts of the same
// project get different ids and the same checkout keeps its id forever.
export function repoIdFor(root: string): string {
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 8);
  // A repository directory can be named anything, and the id goes in a URL path
  // segment, so anything outside the safe set collapses to a dash. Trimming the
  // edges keeps the join below from doubling up a separator.
  const name = basename(root)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return name === '' ? digest : `${name}-${digest}`;
}
