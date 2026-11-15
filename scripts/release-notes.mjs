import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { changelogEntries } from '../docs/changelog/changelog-data.ts';

export function releaseNotes(tag, entries = changelogEntries) {
  const matches = entries.filter((entry) => entry.version === tag);
  if (matches.length !== 1) throw new Error(`Expected exactly one changelog entry for ${tag}`);
  const entry = matches[0];
  const lines = [entry.summary, ''];
  const headings = { new: 'New', improved: 'Improved', fixed: 'Fixed', deprecated: 'Deprecated' };
  for (const [type, heading] of Object.entries(headings)) {
    const items = entry.items.filter((item) => item.type === type);
    if (items.length) {
      lines.push(
        `## ${heading}`,
        '',
        ...items.map((item) => `- **${item.title}** — ${item.description}`),
        ''
      );
    }
  }
  if (entry.acknowledgements?.length) {
    lines.push(
      '## Thanks',
      '',
      ...entry.acknowledgements.map(
        (a) =>
          `- @${a.githubUsername}: ${a.contribution} ([#${a.pullRequest}](https://github.com/tombadilo-bombadilo/budgero/pull/${a.pullRequest}))`
      ),
      ''
    );
  }
  lines.push(
    '## Downloads',
    '',
    'Choose the ZIP archive for your operating system and CPU architecture. Verify it against `checksums.txt`.',
    '',
    `Docker: \`docker pull budgero/budgero:${tag}\``,
    ''
  );
  return lines.join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, output] = process.argv.slice(2);
  if (!tag || !output) throw new Error('Usage: release-notes.mjs <tag> <output>');
  writeFileSync(output, releaseNotes(tag));
}
