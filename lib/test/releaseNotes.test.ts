import { describe, expect, test } from 'bun:test';

import { extractSection, MissingChangelogSection } from '@/lib/releaseNotes';

const CHANGELOG = `# Changelog

Preamble that belongs to no release.

## v0.2.0

Second release.

### Details

More.

## v0.1.0

First release.

## v0.0.1

Older.
`;

describe('extractSection', () => {
  test('takes only the named version', () => {
    expect(extractSection(CHANGELOG, 'v0.1.0').trim()).toBe('First release.');
  });

  // Deeper headings are part of the section; only a sibling ## ends it.
  test('keeps subsections and stops at the next version', () => {
    const body = extractSection(CHANGELOG, 'v0.2.0');
    expect(body).toContain('### Details');
    expect(body).toContain('More.');
    expect(body).not.toContain('First release.');
  });

  test('reads the last section, which has no following heading', () => {
    expect(extractSection(CHANGELOG, 'v0.0.1').trim()).toBe('Older.');
  });

  test('refuses a version with no section', () => {
    expect(() => extractSection(CHANGELOG, 'v9.9.9')).toThrow(
      MissingChangelogSection
    );
  });

  // An empty section is the same mistake as a missing one: a release whose notes
  // nobody wrote, noticed only after people read it.
  test('refuses a section with nothing in it', () => {
    expect(() => extractSection('## v1.0.0\n\n## v0.9.0\n\nold\n', 'v1.0.0')).toThrow(
      MissingChangelogSection
    );
  });

  test('does not match a version that is a prefix of another', () => {
    expect(() => extractSection('## v0.1.00\n\nx\n', 'v0.1.0')).toThrow(
      MissingChangelogSection
    );
  });
});
