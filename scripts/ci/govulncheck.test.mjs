import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  IGNORE_FILE,
  SERVER_DIR,
  evaluate,
  formatTrace,
  parseIgnores,
  parseStream,
} from './govulncheck.mjs';

const now = new Date('2026-11-13T12:00:00Z');
const config = {
  config: {
    protocol_version: 'v1.0.0',
    scanner_version: 'v1.9.0',
    go_version: 'go1.26.11',
    scan_level: 'symbol',
  },
};
const osv = (id, alias, summary = `${id} summary`) => ({ osv: { id, aliases: [alias], summary } });
const echoFrame = {
  module: 'github.com/labstack/echo/v4',
  version: 'v4.16.1',
  package: 'github.com/labstack/echo/v4',
};
const called = (id, fixed) => ({
  finding: {
    osv: id,
    ...(fixed ? { fixed_version: fixed } : {}),
    trace: [
      {
        ...echoFrame,
        function: 'Group',
        receiver: '*Echo',
        position: { filename: 'echo.go', line: 1, column: 1 },
      },
      {
        module: 'budgero-server',
        package: 'budgero-server/internal/routes',
        function: 'SetupRoutes',
        position: { filename: 'internal/routes/routes.go', line: 25, column: 16 },
      },
    ],
  },
});
const moduleOnly = (id) => ({
  finding: {
    osv: id,
    fixed_version: 'v0.62.0',
    trace: [{ module: 'golang.org/x/net', version: 'v0.60.0' }],
  },
});
const packageOnly = (id) => ({
  finding: {
    osv: id,
    trace: [{ ...echoFrame, package: 'github.com/labstack/echo/v4/middleware' }],
  },
});
const stream = (...messages) => messages.map((m) => JSON.stringify(m, null, 2)).join('\n');
const ignore = (id, alias, ignoreUntil = '2026-12-10') => ({
  id,
  alias,
  ignoreUntil,
  reason: `${id} is not reachable`,
});
const echoIgnores = [
  ignore('GO-2026-6872', 'GHSA-246p-cpwv-v3jq'),
  ignore('GO-2026-6875', 'GHSA-99jh-6h7p-pp36'),
];
const report = (result) => result.lines.join('\n');

test('nothing found passes', () => {
  const result = evaluate(stream(config), [], now);
  assert.equal(result.ok, true);
  assert.match(report(result), /OK: no unignored vulnerabilities in our code \(0 ignored\)/);
});

test('only ignored findings pass and list each reason', () => {
  const out = stream(
    config,
    osv('GO-2026-6872', 'GHSA-246p-cpwv-v3jq'),
    osv('GO-2026-6875', 'GHSA-99jh-6h7p-pp36'),
    called('GO-2026-6872'),
    called('GO-2026-6875')
  );
  const result = evaluate(out, echoIgnores, now);
  assert.equal(result.ok, true);
  assert.match(
    report(result),
    /GO-2026-6872 \(GHSA-246p-cpwv-v3jq\) in github.com\/labstack\/echo\/v4@v4.16.1, until 2026-12-10: GO-2026-6872 is not reachable/
  );
  assert.match(report(result), /GO-2026-6875 \(GHSA-99jh-6h7p-pp36\)/);
  assert.match(report(result), /2 ignored/);
});

test('an ignore matches by alias when the GO id changes', () => {
  const out = stream(config, osv('GO-2026-9999', 'GHSA-99jh-6h7p-pp36'), called('GO-2026-9999'));
  assert.equal(evaluate(out, [ignore('GO-2026-6875', 'GHSA-99jh-6h7p-pp36')], now).ok, true);
});

test('an expired ignore fails and says so', () => {
  const out = stream(config, osv('GO-2026-6875', 'GHSA-99jh-6h7p-pp36'), called('GO-2026-6875'));
  const ignores = [ignore('GO-2026-6875', 'GHSA-99jh-6h7p-pp36', '2026-11-13')];
  const result = evaluate(out, ignores, now);
  assert.equal(result.ok, false);
  assert.match(
    report(result),
    /ignore for GO-2026-6875 in govulncheck-ignore.json expired on 2026-11-13/
  );
  // Still ignored the day before the expiry date.
  assert.equal(evaluate(out, ignores, new Date('2026-11-12T23:59:59Z')).ok, true);
});

test('an unignored finding fails with id, summary, module, versions and a trace', () => {
  const out = stream(
    config,
    osv('GO-2026-1234', 'GHSA-aaaa-bbbb-cccc', 'Bad thing in echo'),
    called('GO-2026-1234', 'v4.17.0')
  );
  const result = evaluate(out, [], now);
  assert.equal(result.ok, false);
  const text = report(result);
  assert.match(text, /Vulnerability: GO-2026-1234 \(GHSA-aaaa-bbbb-cccc\)/);
  assert.match(text, /Bad thing in echo/);
  assert.match(text, /Module: github.com\/labstack\/echo\/v4/);
  assert.match(text, /Found in: github.com\/labstack\/echo\/v4@v4.16.1/);
  assert.match(text, /Fixed in: github.com\/labstack\/echo\/v4@v4.17.0/);
  assert.match(
    text,
    /Example trace: internal\/routes\/routes.go:25:16: routes.SetupRoutes calls echo.Echo.Group/
  );
  assert.match(text, /FAIL: our code is affected by 1 vulnerability/);
});

test('imports-only and module-only findings stay informational', () => {
  const out = stream(
    config,
    osv('GO-2026-6860', 'GHSA-x'),
    moduleOnly('GO-2026-6860'),
    osv('GO-2026-7000', 'GHSA-y'),
    packageOnly('GO-2026-7000')
  );
  const result = evaluate(out, [], now);
  assert.equal(result.ok, true);
  assert.match(
    report(result),
    /Informational, not called by our code .*: GO-2026-6860, GO-2026-7000/
  );
});

test('a stale ignore entry is noted but does not fail', () => {
  const result = evaluate(
    stream(config, osv('GO-2026-6875', 'GHSA-99jh-6h7p-pp36'), packageOnly('GO-2026-6875')),
    echoIgnores,
    now
  );
  assert.equal(result.ok, true);
  assert.match(
    report(result),
    /ignore for GO-2026-6872 \(GHSA-246p-cpwv-v3jq\) is no longer needed/
  );
  assert.match(
    report(result),
    /ignore for GO-2026-6875 \(GHSA-99jh-6h7p-pp36\) is no longer needed/
  );
});

test('broken or foreign output throws instead of passing', () => {
  assert.throws(
    () => evaluate('govulncheck: loading packages: no Go files\n', [], now),
    /unexpected output/
  );
  assert.throws(() => evaluate(stream(config).slice(0, -3), [], now), /ended inside a JSON object/);
  assert.throws(() => evaluate('', [], now), /no config message/);
  assert.throws(
    () => evaluate(stream({ config: { scan_level: 'module' } }), [], now),
    /symbol-level scan/
  );
});

test('stream parsing handles braces and quotes inside strings', () => {
  const messages = parseStream(
    stream({ osv: { id: 'GO-1', summary: 'a "{" } brace \\ here' } }, config)
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[0].osv.summary, 'a "{" } brace \\ here');
});

test('traces through intermediate calls read like the text output', () => {
  const trace = [
    { package: 'github.com/labstack/echo/v4/middleware', function: 'proxyHTTP' },
    { package: 'net/http', function: 'ListenAndServe', receiver: '*Server' },
    {
      package: 'budgero-server/cmd/shared',
      function: 'serveUntilSignal',
      position: { filename: 'cmd/shared/server.go', line: 280, column: 44 },
    },
  ];
  assert.equal(
    formatTrace(trace),
    'cmd/shared/server.go:280:44: shared.serveUntilSignal calls http.Server.ListenAndServe, which eventually calls middleware.proxyHTTP'
  );
});

test('bad ignore entries are rejected', () => {
  assert.throws(() => parseIgnores({}), /"ignore" array/);
  assert.throws(
    () => parseIgnores({ ignore: [{ ...echoIgnores[0], id: 'GHSA-x' }] }),
    /GO-YYYY-NNNN/
  );
  assert.throws(() => parseIgnores({ ignore: [{ ...echoIgnores[0], alias: undefined }] }), /alias/);
  assert.throws(
    () => parseIgnores({ ignore: [{ ...echoIgnores[0], ignoreUntil: '2026-12-10T00:00:00Z' }] }),
    /ignoreUntil/
  );
  assert.throws(() => parseIgnores({ ignore: [{ ...echoIgnores[0], reason: ' ' }] }), /reason/);
});

test('the real ignore file is valid and matches osv-scanner.toml', () => {
  const entries = parseIgnores(JSON.parse(readFileSync(IGNORE_FILE, 'utf8')));
  const toml = readFileSync(join(SERVER_DIR, 'osv-scanner.toml'), 'utf8');
  const osvIgnores = new Map(
    [
      ...toml.matchAll(/id = "([^"]+)"\s*\nignoreUntil = (\S+)\s*\nreason = "((?:[^"\\]|\\.)*)"/g),
    ].map(([, id, until, reason]) => [id, { until, reason }])
  );
  for (const entry of entries) {
    const match = osvIgnores.get(entry.alias);
    assert.ok(match, `${entry.alias} (${entry.id}) is missing from osv-scanner.toml`);
    assert.equal(
      match.until,
      `${entry.ignoreUntil}T00:00:00Z`,
      `${entry.alias}: expiry differs from osv-scanner.toml`
    );
    assert.equal(
      match.reason,
      entry.reason,
      `${entry.alias}: reason differs from osv-scanner.toml`
    );
  }
});
