import { describe, expect, test } from 'bun:test';

import { getPatchViewerHref } from '@/lib/getPatchViewerHref';
import {
  describeSupportedPatchDomains,
  HIDDEN_PATCH_DOMAINS,
  isSupportedPatchDomain,
} from '@/lib/patchDomains';

describe('isSupportedPatchDomain', () => {
  test('accepts a listed host and its subdomains', () => {
    expect(isSupportedPatchDomain('github.com')).toBe(true);
    expect(isSupportedPatchDomain('tangled.org')).toBe(true);
    expect(isSupportedPatchDomain('git.tangled.org')).toBe(true);
  });

  test('is case-insensitive, as hostnames are', () => {
    expect(isSupportedPatchDomain('Tangled.ORG')).toBe(true);
  });

  test('refuses a host nothing can fetch a patch from', () => {
    expect(isSupportedPatchDomain('gitlab.com')).toBe(false);
  });

  // A suffix match on the bare string would let an attacker register
  // `nottangled.org` and be treated as the real one.
  test('does not match a host that merely ends with the root', () => {
    expect(isSupportedPatchDomain('nottangled.org')).toBe(false);
  });
});

describe('HIDDEN_PATCH_DOMAINS', () => {
  // github.com is fetched by its own path in the diff route; if it appeared
  // here it would be rewritten as a hidden domain with an appended extension.
  test('excludes github.com', () => {
    expect(
      HIDDEN_PATCH_DOMAINS.map((domain) => domain.domainRoot)
    ).not.toContain('github.com');
  });

  test('carries an extension for every host it lists', () => {
    for (const domain of HIDDEN_PATCH_DOMAINS) {
      expect(domain.defaultExtension).toStartWith('.');
    }
  });
});

describe('describeSupportedPatchDomains', () => {
  test('reads as a sentence', () => {
    expect(describeSupportedPatchDomains()).toBe('github.com and tangled.org');
  });
});

describe('getPatchViewerHref domains', () => {
  test('keeps a github URL on the bare path', () => {
    expect(getPatchViewerHref('https://github.com/owner/repo/pull/1')).toBe(
      '/owner/repo/pull/1'
    );
  });

  test('carries an allowlisted host through as ?domain=', () => {
    expect(getPatchViewerHref('https://tangled.org/@did/repo/pulls/3')).toBe(
      '/@did/repo/pulls/3?domain=tangled.org'
    );
  });

  test('does the same without a protocol', () => {
    expect(getPatchViewerHref('tangled.org/@did/repo/pulls/3')).toBe(
      '/@did/repo/pulls/3?domain=tangled.org'
    );
  });

  // Silently resolving this to `/owner/repo/...` would render someone else's
  // repository of the same name from github.com.
  test('refuses a host it cannot fetch from', () => {
    expect(
      getPatchViewerHref('https://gitlab.com/owner/repo/-/merge_requests/1')
    ).toBeUndefined();
    expect(
      getPatchViewerHref('gitlab.com/owner/repo/-/merge_requests/1')
    ).toBeUndefined();
  });
});
