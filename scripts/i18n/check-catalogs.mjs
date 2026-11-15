#!/usr/bin/env node
/**
 * Fails when a locale catalog has fallen behind the English source.
 *
 * Without this the catalogs silently rot: a feature ships, `lingui extract`
 * adds English-only messages, and non-English users see mixed-language UI.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOGS = join(ROOT, 'packages', 'app', 'src', 'locales');
const SOURCE = 'en';
const TARGETS = ['de', 'fr', 'es', 'nl'];

function parse(path) {
  const entries = new Map();
  let id = null;
  let key = null;
  let buf = [];

  const unquote = (lines) => lines.map((l) => (l.startsWith('"') ? JSON.parse(l) : l)).join('');
  const flush = () => {
    if (key === 'msgid') id = unquote(buf);
    else if (key === 'msgstr' && id !== null) entries.set(id, unquote(buf));
    key = null;
    buf = [];
  };

  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('#') || line === '') {
      flush();
      continue;
    }
    if (line.startsWith('msgid ')) {
      flush();
      key = 'msgid';
      buf = [line.slice(6)];
    } else if (line.startsWith('msgstr ')) {
      flush();
      key = 'msgstr';
      buf = [line.slice(7)];
    } else if (line.startsWith('"') && key) {
      buf.push(line);
    }
  }
  flush();
  entries.delete('');
  return entries;
}

const sourcePath = join(CATALOGS, SOURCE, 'messages.po');
if (!existsSync(sourcePath)) {
  console.error(`missing source catalog: ${sourcePath}`);
  process.exit(1);
}

const source = parse(sourcePath);
let failed = false;

console.log(`source (${SOURCE}): ${source.size} messages\n`);

for (const locale of TARGETS) {
  const path = join(CATALOGS, locale, 'messages.po');
  if (!existsSync(path)) {
    console.error(`  ${locale}: MISSING CATALOG`);
    failed = true;
    continue;
  }
  const target = parse(path);
  const missing = [...source.keys()].filter((id) => !target.get(id));

  if (missing.length) {
    failed = true;
    console.error(`  ${locale}: ${missing.length} untranslated`);
    for (const id of missing.slice(0, 5)) console.error(`      ${JSON.stringify(id.slice(0, 70))}`);
    if (missing.length > 5) console.error(`      ... and ${missing.length - 5} more`);
  } else {
    console.log(`  ${locale}: complete`);
  }
}

if (failed) {
  console.error(
    '\nRun `pnpm --dir packages/app run i18n:extract`, then translate the new messages.\n' +
      'See i18n/README.md — the glossary in i18n/glossary.json is binding.'
  );
  process.exit(1);
}

console.log('\nAll locales complete.');

// Every English guide must have a locale counterpart with the same stable topic ID.
const DOCS = join(ROOT, 'docs', 'user');
for (const name of readdirSync(DOCS).filter((name) => name.endsWith('.mdx'))) {
  const source = readFileSync(join(DOCS, name), 'utf8');
  const topic = source.match(/^topicId:\s*(.+)$/m)?.[1];
  for (const locale of TARGETS) {
    const path = join(DOCS, locale, name);
    if (
      !existsSync(path) ||
      readFileSync(path, 'utf8').match(/^topicId:\s*(.+)$/m)?.[1] !== topic
    ) {
      failed = true;
      console.error(`${locale}: missing or mismatched guide ${name}`);
    }
  }
}
if (failed) process.exit(1);
console.log('Guide coverage complete.');
