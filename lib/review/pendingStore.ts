import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ThreadAnchor } from './types';

export interface PendingComment {
  id: string;
  anchor: ThreadAnchor;
  body: string;
  createdAt: string;
}

function stateDir(): string {
  // XDG where it is set, the macOS location otherwise. Not the repository: a
  // pull request review is not tied to any checkout.
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg != null && xdg.trim() !== '') return join(xdg, 'hunkyard');
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'hunkyard')
    : join(homedir(), '.local', 'state', 'hunkyard');
}

function pendingPath(key: string): string {
  // The key is owner/repo/pull, which cannot go in a filename as-is.
  return join(stateDir(), 'pending', `${key.replace(/\//g, '-')}.json`);
}

// Comments queued for a review that has not been submitted.
//
// Held here rather than in GitHub's own pending review because there is no
// supported way to add a comment to an existing pending review incrementally:
// a review is created with its full comment list. So the queue lives locally
// until submit, which also means it survives a restart -- the thing the layer
// this replaces got most wrong.
export class PendingCommentStore {
  constructor(private readonly key: string) {}

  async list(): Promise<PendingComment[]> {
    try {
      const text = await readFile(pendingPath(this.key), 'utf8');
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? (parsed as PendingComment[]) : [];
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      // A corrupt queue should not make the review unopenable.
      return [];
    }
  }

  private async write(comments: PendingComment[]): Promise<void> {
    const path = pendingPath(this.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(comments, null, 2), 'utf8');
  }

  async add(comment: Omit<PendingComment, 'id' | 'createdAt'>): Promise<PendingComment> {
    const comments = await this.list();
    const created: PendingComment = {
      ...comment,
      id: `p_${Date.now().toString(36)}_${comments.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    await this.write([...comments, created]);
    return created;
  }

  async remove(id: string): Promise<void> {
    const comments = await this.list();
    await this.write(comments.filter((comment) => comment.id !== id));
  }

  async clear(): Promise<void> {
    try {
      await unlink(pendingPath(this.key));
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
  }
}
