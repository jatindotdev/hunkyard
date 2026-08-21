// A release's notes are its section of the changelog, and nothing else. The
// README is where install and usage live; repeating them on every release page
// only buries what actually changed.

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
// release have its own `### What it does`.
export function extractSection(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) throw new MissingChangelogSection(version);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

  if (body === '') throw new MissingChangelogSection(version);
  return `${body}\n`;
}
