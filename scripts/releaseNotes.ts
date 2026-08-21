#!/usr/bin/env bun
// Writes the composed release body for a tag.
//
//   bun scripts/releaseNotes.ts v0.1.0 > notes.md
//
// Fails rather than falling back to something generated: a release with notes
// nobody wrote is worse than a failed publish, because it is only noticed after
// people read it.
import { composeReleaseNotes } from '../lib/releaseNotes';

const version = process.argv[2];
if (version == null || version === '') {
  console.error('usage: releaseNotes.ts <version>   e.g. v0.1.0');
  process.exit(2);
}

try {
  process.stdout.write(
    composeReleaseNotes({
      version,
      changelog: await Bun.file('CHANGELOG.md').text(),
      template: await Bun.file('.github/release-template.md').text(),
      commit: process.env.GITHUB_SHA ?? 'HEAD',
      runUrl:
        process.env.GITHUB_SERVER_URL != null &&
        process.env.GITHUB_REPOSITORY != null &&
        process.env.GITHUB_RUN_ID != null
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : 'https://github.com/jatindotdev/hunkyard/actions',
    })
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
