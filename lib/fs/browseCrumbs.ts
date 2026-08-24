export interface BrowseCrumb {
  name: string;
  path: string;
}

// The path segments from the root down to a directory, for a breadcrumb.
//
// Its own string handling rather than node:path, because this is the one piece
// of path logic the browser needs and importing node:path into client code
// leaves the whole page blank.
export function browseCrumbs(path: string): BrowseCrumb[] {
  const separator = path.startsWith('/') ? '/' : '\\';
  const trimmed =
    path.length > 1 && path.endsWith(separator) ? path.slice(0, -1) : path;
  const segments = trimmed.split(separator);
  // A posix path starts with an empty segment; a Windows one starts with the
  // drive.
  const first = segments[0] ?? '';
  const root = first === '' ? separator : `${first}${separator}`;

  const crumbs: BrowseCrumb[] = [{ name: root, path: root }];
  let current = first === '' ? '' : first;
  for (const segment of segments.slice(1)) {
    if (segment === '') continue;
    current = `${current}${separator}${segment}`;
    crumbs.push({ name: segment, path: current });
  }
  return crumbs;
}
