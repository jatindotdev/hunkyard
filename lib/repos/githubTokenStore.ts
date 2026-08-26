import { chmod, readFile, unlink, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { stateDir } from './stateDir';

// A GitHub token the server can still find when nothing started it from a
// terminal.
//
// The CLI used to hand its environment to the server by starting it, so a token
// exported in your shell reached it for free. Nothing starts the server now
// except the service manager, which has no shell and no session -- and `gh auth
// token` is not a way around that when `gh` itself is reading GITHUB_TOKEN from
// the environment, which is the common case. Without somewhere to put it,
// private pull requests simply stop working once you register the URL.
//
// So it is written down. 0600, in the state directory, which is the same
// treatment `gh` gives its own and strictly better than the browser's
// localStorage -- the alternative the UI falls back to, where any script on the
// page can read it.
function tokenPath(): string {
  return join(stateDir(), 'github-token');
}

export async function readStoredGitHubToken(): Promise<string | null> {
  try {
    const token = (await readFile(tokenPath(), 'utf8')).trim();
    return token === '' ? null : token;
  } catch {
    return null;
  }
}

// Writes only when it would change something, so an unchanged token does not
// rewrite the file on every invocation.
export async function storeGitHubToken(token: string | null): Promise<void> {
  const current = await readStoredGitHubToken();
  if (current === token) return;

  if (token == null || token.trim() === '') {
    await unlink(tokenPath()).catch(() => undefined);
    return;
  }

  await mkdir(stateDir(), { recursive: true });
  await writeFile(tokenPath(), `${token.trim()}\n`, { mode: 0o600 });
  // Explicit, because an existing file keeps the mode it was created with and
  // writeFile's mode only applies when it creates one.
  await chmod(tokenPath(), 0o600).catch(() => undefined);
}

export async function forgetStoredGitHubToken(): Promise<void> {
  await unlink(tokenPath()).catch(() => undefined);
}
