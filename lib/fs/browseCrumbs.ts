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
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const crumbs: BrowseCrumb[] = [{ name: '/', path: '/' }];

  let current = '';
  for (const segment of trimmed.split('/')) {
    if (segment === '') continue;
    current = `${current}/${segment}`;
    crumbs.push({ name: segment, path: current });
  }
  return crumbs;
}
