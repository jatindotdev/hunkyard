// The GitHub token the local server holds on the user's behalf.
//
// Under the local-first model the CLI resolves a token once at startup (from
// `gh auth token`, or GH_TOKEN/GITHUB_TOKEN) and keeps it in this process. The
// browser never receives it, which is the whole point: a token that can write
// reviews should not sit in localStorage where any script on the page can read
// it.
//
// A token pasted into the UI still works and takes precedence, for anyone
// without `gh` installed.
export function resolveServerGitHubToken(): string | undefined {
  const candidates = [
    process.env.HUNKYARD_GITHUB_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_TOKEN,
  ];
  for (const candidate of candidates) {
    if (candidate != null && candidate.trim() !== '') return candidate.trim();
  }
  return undefined;
}

// Whether the server can talk to GitHub without the browser supplying anything,
// so the UI can say so instead of asking for a token it does not need.
export function hasServerGitHubToken(): boolean {
  return resolveServerGitHubToken() != null;
}
