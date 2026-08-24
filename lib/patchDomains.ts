// Which hosts a pasted URL is allowed to name.
//
// github.com is the default and needs no `?domain=`. Anything else is fetched
// through the diff route's hidden-domain path, which has to know the extension
// to append, so a host without a rule here has no way to be fetched at all --
// resolving it to a path anyway would silently render it as though it were a
// github.com URL.
export interface PatchDomain {
  domainRoot: string;
  // Appended to the path when fetching the patch. github.com chooses between
  // `.diff` and `.patch` itself, so it has none.
  defaultExtension?: string;
}

export const GITHUB_PATCH_DOMAIN = 'github.com';

export const PATCH_DOMAINS: readonly PatchDomain[] = [
  { domainRoot: GITHUB_PATCH_DOMAIN },
  { domainRoot: 'tangled.org', defaultExtension: '.patch' },
];

// A host reached through `?domain=`: everything the diff route serves that is
// not github.com, which is to say everything with an extension rule.
export type HiddenPatchDomain = PatchDomain & { defaultExtension: string };

export const HIDDEN_PATCH_DOMAINS: readonly HiddenPatchDomain[] =
  PATCH_DOMAINS.filter(
    (domain): domain is HiddenPatchDomain => domain.defaultExtension != null
  );

// A domain root matches itself and its subdomains, so a forge that serves
// patches from `git.example.org` is covered by allowing `example.org`.
export function matchPatchDomain(hostname: string): PatchDomain | undefined {
  const name = hostname.toLowerCase();
  return PATCH_DOMAINS.find(
    (domain) =>
      name === domain.domainRoot || name.endsWith(`.${domain.domainRoot}`)
  );
}

export function isSupportedPatchDomain(hostname: string): boolean {
  return matchPatchDomain(hostname) != null;
}

// For the message shown when someone pastes a URL from somewhere else.
export function describeSupportedPatchDomains(): string {
  const roots = PATCH_DOMAINS.map((domain) => domain.domainRoot);
  const last = roots[roots.length - 1];
  return roots.length < 2
    ? (last ?? '')
    : `${roots.slice(0, -1).join(', ')} and ${last}`;
}
