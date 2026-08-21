import { homedir } from 'node:os';
import { join } from 'node:path';

// XDG where it is set, the macOS location otherwise. Not the repository: the
// daemon serves several at once, so its own state cannot live inside one.
export function stateDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg != null && xdg.trim() !== '') return join(xdg, 'hunkyard');
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'hunkyard')
    : join(homedir(), '.local', 'state', 'hunkyard');
}
