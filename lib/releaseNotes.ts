// Composes a release body from the changelog section for a version and the
// boilerplate template, so notes are written deliberately rather than generated
// from commit subjects.

export interface ReleaseNotesInput {
  version: string;
  changelog: string;
  template: string;
  commit: string;
  runUrl: string;
}

export class MissingChangelogSection extends Error {
  constructor(version: string) {
    super(
      `CHANGELOG.md has no "## ${version}" section. Add one before tagging, ` +
        'or the release would ship with no notes.'
    );
    this.name = 'MissingChangelogSection';
  }
}

// The body of one `## <version>` section, up to the next section at the same
// level. Deeper headings inside it are part of the section, which is what lets a
// release have its own `### What is in it`.
export function extractSection(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex(
    (line) => line.trim() === `## ${version}`
  );
  if (start === -1) throw new MissingChangelogSection(version);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

  if (body === '') throw new MissingChangelogSection(version);
  return body;
}

export function composeReleaseNotes({
  version,
  changelog,
  template,
  commit,
  runUrl,
}: ReleaseNotesInput): string {
  const notes = extractSection(changelog, version);
  const filled = template
    .replace('{{NOTES}}', notes)
    .replace(/\{\{VERSION\}\}/g, version)
    .replace(/\{\{COMMIT\}\}/g, commit)
    .replace(/\{\{RUN_URL\}\}/g, runUrl);

  // A placeholder left behind means the template and this function disagree,
  // which would publish `{{SOMETHING}}` to the release page.
  const leftover = filled.match(/\{\{[A-Z_]+\}\}/);
  if (leftover != null) {
    throw new Error(`Release template has an unfilled ${leftover[0]}.`);
  }
  return `${filled.trim()}\n`;
}
