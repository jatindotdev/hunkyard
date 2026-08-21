#!/usr/bin/env bun
// Writes a release's notes: its section of CHANGELOG.md.
//
//   bun scripts/releaseNotes.ts v0.1.0 > notes.md
//
// Fails rather than falling back to something generated from commit subjects. A
// release with notes nobody wrote is worse than a failed publish, because it is
// only noticed after people read it.
import { extractSection } from '../lib/releaseNotes';

const version = process.argv[2];
if (version == null || version === '') {
  console.error('usage: releaseNotes.ts <version>   e.g. v0.1.0');
  process.exit(2);
}

try {
  process.stdout.write(
    extractSection(await Bun.file('CHANGELOG.md').text(), version)
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
