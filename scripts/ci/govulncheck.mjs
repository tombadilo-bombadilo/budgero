// Runs govulncheck on the Go server and fails on any vulnerability our code
// calls, unless packages/server/govulncheck-ignore.json lists it and the
// ignore has not expired. govulncheck has no ignore mechanism of its own.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../packages/server');
export const IGNORE_FILE = join(SERVER_DIR, 'govulncheck-ignore.json');
const GOVULNCHECK = 'golang.org/x/vuln/cmd/govulncheck@latest';

/** Splits govulncheck's stream of pretty-printed JSON objects. Throws on anything else. */
export function parseStream(text) {
  const messages = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"' && depth > 0) {
      inString = true;
    } else if (ch === '{') {
      if (depth++ === 0) start = i;
    } else if (ch === '}' && depth > 0) {
      if (--depth === 0) messages.push(JSON.parse(text.slice(start, i + 1)));
    } else if (depth === 0 && !/\s/.test(ch)) {
      throw new Error(`unexpected output at offset ${i}: ${JSON.stringify(text.slice(i, i + 60))}`);
    }
  }
  if (depth !== 0 || inString) throw new Error('output ended inside a JSON object');
  return messages;
}

/** Validates the ignore file's contents; returns its entries. */
export function parseIgnores(json) {
  const entries = json?.ignore;
  if (!Array.isArray(entries)) throw new Error('ignore file needs an "ignore" array');
  for (const entry of entries) {
    const label = JSON.stringify(entry?.id ?? entry);
    if (typeof entry?.id !== 'string' || !/^GO-\d{4}-\d+$/.test(entry.id)) {
      throw new Error(`ignore entry ${label}: id must be a GO-YYYY-NNNN id`);
    }
    if (typeof entry.alias !== 'string' || !/^GHSA-/.test(entry.alias)) {
      throw new Error(`ignore entry ${label}: alias must be its GHSA id`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.ignoreUntil ?? '') || isNaN(untilTime(entry))) {
      throw new Error(`ignore entry ${label}: ignoreUntil must be a YYYY-MM-DD date`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`ignore entry ${label}: reason is required`);
    }
  }
  return entries;
}

// Same meaning as osv-scanner's `ignoreUntil = <date>T00:00:00Z`.
const untilTime = (entry) => Date.parse(`${entry.ignoreUntil}T00:00:00Z`);

const shortName = (frame) => {
  // Major-version suffixes are not the package name: echo/v4 is package echo.
  const parts = (frame.package ?? frame.module ?? '').split('/');
  const pkg = parts.length > 1 && /^v\d+$/.test(parts.at(-1)) ? parts.at(-2) : parts.at(-1);
  const receiver = frame.receiver ? `${frame.receiver.replace(/^\*/, '')}.` : '';
  return `${pkg}.${receiver}${frame.function}`;
};

/** One-line trace in the style of govulncheck's text output. */
export function formatTrace(trace) {
  const entry = trace[trace.length - 1];
  const pos = entry.position
    ? `${entry.position.filename}:${entry.position.line}:${entry.position.column}: `
    : '';
  let line = `${pos}${shortName(entry)} calls ${shortName(trace[trace.length - 2])}`;
  if (trace.length > 2) line += `, which eventually calls ${shortName(trace[0])}`;
  return line;
}

/**
 * Decides the outcome of a govulncheck JSON run. Pure: `now` is a Date.
 * Returns { ok, lines } where lines is the report to print.
 */
export function evaluate(output, ignores, now = new Date()) {
  const messages = parseStream(output);
  const config = messages.find((m) => m.config)?.config;
  if (!config) throw new Error('govulncheck printed no config message; is this its JSON output?');
  if (config.scan_level !== 'symbol') {
    throw new Error(`expected a symbol-level scan, got ${JSON.stringify(config.scan_level)}`);
  }
  const osvs = new Map(messages.filter((m) => m.osv).map((m) => [m.osv.id, m.osv]));

  // A finding whose innermost frame names a function is one our code calls;
  // those are what make the plain text run exit 3. Package- and module-level
  // findings are informational there, so they are here too.
  const called = new Map();
  const informational = new Set();
  for (const { finding } of messages.filter((m) => m.finding)) {
    const trace = finding.trace ?? [];
    if (trace[0]?.function) {
      const list = called.get(finding.osv) ?? [];
      list.push(finding);
      called.set(finding.osv, list);
    } else {
      informational.add(finding.osv);
    }
  }
  for (const id of called.keys()) informational.delete(id);

  const lines = [
    `govulncheck ${config.scanner_version ?? '?'} with ${config.go_version ?? '?'}, DB updated ${config.db_last_modified ?? '?'}`,
  ];
  let failures = 0;
  const ignoredLines = [];
  for (const [id, findings] of [...called].sort(([a], [b]) => a.localeCompare(b))) {
    const osv = osvs.get(id) ?? { id, aliases: [], summary: '(no advisory text in the output)' };
    const entry = ignores.find((e) => e.id === id || (osv.aliases ?? []).includes(e.alias));
    const first = findings[0].trace[0];
    const where = `${first.module}@${first.version ?? '?'}`;
    if (entry && now.getTime() < untilTime(entry)) {
      ignoredLines.push(
        `  ${id} (${entry.alias}) in ${where}, until ${entry.ignoreUntil}: ${entry.reason}`
      );
      continue;
    }
    failures++;
    const example = findings
      .filter((f) => f.trace.length >= 2)
      .sort((a, b) => a.trace.length - b.trace.length)[0];
    lines.push(
      '',
      `Vulnerability: ${id}${osv.aliases?.length ? ` (${osv.aliases.join(', ')})` : ''}`,
      `  ${osv.summary ?? ''}`,
      `  More info: ${osv.database_specific?.url ?? `https://pkg.go.dev/vuln/${id}`}`,
      `  Module: ${first.module}`,
      `    Found in: ${where}`,
      `    Fixed in: ${findings[0].fixed_version ? `${first.module}@${findings[0].fixed_version}` : 'N/A'}`,
      `    Example trace: ${example ? formatTrace(example.trace) : '(none)'}`
    );
    if (entry) {
      lines.push(
        `  The ignore for ${id} in govulncheck-ignore.json expired on ${entry.ignoreUntil}: fix it or renew the ignore with a reason.`
      );
    }
  }
  if (ignoredLines.length) lines.push('', 'Ignored (govulncheck-ignore.json):', ...ignoredLines);
  for (const entry of ignores) {
    const used = [...called.keys()].some(
      (id) => id === entry.id || (osvs.get(id)?.aliases ?? []).includes(entry.alias)
    );
    if (!used) {
      lines.push(
        '',
        `Note: the ignore for ${entry.id} (${entry.alias}) is no longer needed; our code no longer calls it. Remove it here and in osv-scanner.toml.`
      );
    }
  }
  if (informational.size) {
    lines.push(
      '',
      `Informational, not called by our code (same as govulncheck's text mode): ${[...informational].sort().join(', ')}`
    );
  }
  lines.push(
    '',
    failures
      ? `FAIL: our code is affected by ${failures === 1 ? '1 vulnerability that is' : `${failures} vulnerabilities that are`} not ignored.`
      : `OK: no unignored vulnerabilities in our code (${ignoredLines.length} ignored).`
  );
  return { ok: failures === 0, lines };
}

function main() {
  const ignores = parseIgnores(JSON.parse(readFileSync(IGNORE_FILE, 'utf8')));
  const run = spawnSync('go', ['run', GOVULNCHECK, '-format', 'json', './...'], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (run.error) throw new Error(`could not run govulncheck: ${run.error.message}`);
  // In JSON mode govulncheck exits 0 with findings, so any other status is an error.
  if (run.status !== 0) {
    throw new Error(`govulncheck failed (exit ${run.status ?? run.signal}); see its output above`);
  }
  const { ok, lines } = evaluate(run.stdout, ignores);
  console.log(lines.join('\n'));
  return ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main() ? 0 : 1;
  } catch (error) {
    console.error(`security:go: ${error.message}`);
    process.exitCode = 1;
  }
}
