// What `/` is showing. The opener refines itself through the query rather than
// through path segments: `/owner/repo/...` is the viewer's namespace, so a
// path like `/open` would shadow a real GitHub owner of that name.
export type OpenerRoute =
  | { kind: 'chooser' }
  // Browsing the filesystem for a repository to open.
  | { kind: 'browse'; path: string }
  // Choosing what to review inside one repository already opened.
  | { kind: 'targets'; repoId: string };

// A path from the query goes straight into a fetch, so anything that is not an
// absolute filesystem path is treated as no path at all. A NUL is refused for
// the same reason it is server-side: it truncates the string in a syscall.
export function isAbsoluteBrowsePath(path: string): boolean {
  if (path === '' || path.includes('\0')) return false;
  return path.startsWith('/');
}

export function resolveOpenerRoute(search: string): OpenerRoute {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );

  // A repository outranks a directory: committing one navigates from the
  // browser to the picker, and both parameters can briefly be in the URL.
  const repoId = params.get('repo');
  if (repoId != null && repoId.trim() !== '') {
    return { kind: 'targets', repoId: repoId.trim() };
  }

  const path = params.get('path');
  if (path != null && isAbsoluteBrowsePath(path)) {
    return { kind: 'browse', path };
  }

  return { kind: 'chooser' };
}

export function encodeOpenerHref(route: OpenerRoute): string {
  switch (route.kind) {
    case 'browse':
      return `/?path=${encodeURIComponent(route.path)}`;
    case 'targets':
      return `/?repo=${encodeURIComponent(route.repoId)}`;
    default:
      return '/';
  }
}
