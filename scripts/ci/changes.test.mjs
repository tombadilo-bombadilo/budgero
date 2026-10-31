import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { changedPaths, isVersionOnlyChange, planChanges, planEvent } from './changes.mjs';

const none = { app: false, website: false, server: false };
const all = { app: true, website: true, server: true };

for (const [name, paths, expected] of [
  ['published docs', ['packages/website/content/docs/push-api.mdx', 'packages/website/content/docs/de/push-api.mdx'], { ...none, website: true }],
  ['website code and audit', ['packages/website/src/app/page.tsx', 'scripts/i18n/audit-website.mjs'], { ...none, website: true }],
  ['app and shared libraries', ['packages/app/src/app.ts', 'packages/core/src/index.ts', 'packages/runtime/src/index.ts', 'packages/eslint-config/index.js'], { ...none, app: true }],
  ['app catalogs', ['scripts/i18n/check-catalogs.mjs', 'packages/app/src/locales/de/messages.po'], { ...none, app: true }],
  ['Go server', ['packages/server/internal/application/push.go', 'packages/server/go.sum'], { ...none, server: true }],
  ['server build script consumed by app build', ['packages/server/package.json'], { ...none, app: true, server: true }],
  ['mixed changes', ['packages/server/go.mod', 'packages/website/package.json'], { ...none, server: true, website: true }],
  ['repository prose', ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/development.md', '.github/ISSUE_TEMPLATE/bug_report.yml'], none],
  ['repository metadata', ['LICENSE', '.github/FUNDING.yml'], none],
  ['other workflows, including deletions', ['.github/workflows/release.yml', '.github/workflows/dco.yml'], none],
  ['ci workflow changes', ['.github/workflows/ci.yml'], all],
  ['ci workflow alongside other workflows', ['.github/workflows/release.yml', '.github/workflows/ci.yml'], all],
  ['classifier changes (tested by the changes job itself)', ['scripts/ci/changes.mjs', 'scripts/ci/changes.test.mjs'], none],
  ['release-only files', ['packages/server/internal/appmeta/version.txt', 'packages/app/src/features/ai/lib/knowledge/knowledge-base.generated.ts'], none],
  ['manifests without line info still run checks', ['package.json'], all],
  ['app manifest without line info', ['packages/app/package.json'], { ...none, app: true }],
  ['shared lockfile', ['pnpm-lock.yaml'], all],
  ['workspace manifest', ['pnpm-workspace.yaml'], all],
  ['dependency patches', ['packages/website/patches/@contentlayer2__utils@0.5.8.patch'], all],
  ['unknown consumer', ['new-package/build.sh'], all],
  ['empty diff', [], none],
]) {
  test(name, () => assert.deepEqual(planChanges(paths), expected));
}

const version = ['  "version": "1.20.4",', '  "version": "1.20.5",'];
for (const [name, paths, lines, expected] of [
  ['release version bump', ['package.json', 'packages/app/package.json', 'packages/server/package.json', 'packages/server/internal/appmeta/version.txt', 'packages/website/src/lib/changelog-data.ts'], version, { ...none, website: true }],
  ['dependency next to a version bump', ['packages/app/package.json'], [...version, '    "react": "19.1.1",'], { ...none, app: true }],
  ['server manifest script change', ['packages/server/package.json'], ['    "build": "go build ./..."'], { ...none, app: true, server: true }],
]) {
  test(name, () => assert.deepEqual(planChanges(paths, () => lines), expected));
}

test('version-only detection', () => {
  assert.equal(isVersionOnlyChange(version), true);
  assert.equal(isVersionOnlyChange([]), false);
  assert.equal(isVersionOnlyChange(null), false);
  assert.equal(isVersionOnlyChange(['  "name": "x",']), false);
});

test('the assistant knowledge base matches the docs it is generated from', () => {
  // Release builds fail on a stale file; catch it on the PR instead. This job
  // has no node_modules, so run the generator on a scratch copy of its inputs
  // with a no-op prettier and compare the generated docs, not the formatting.
  const repo = new URL('../../', import.meta.url).pathname;
  const file = 'packages/app/src/features/ai/lib/knowledge/knowledge-base.generated.ts';
  const cwd = mkdtempSync(join(tmpdir(), 'budgero-kb-'));
  const docsOf = (source) => {
    const literal = source.split('KNOWLEDGE_DOCS: KnowledgeDoc[] =')[1].trim().replace(/;\s*$/, '');
    return new Function(`return ${literal}`)();
  };
  try {
    for (const dir of ['packages/app/scripts', 'packages/website/content/docs']) {
      cpSync(join(repo, dir), join(cwd, dir), { recursive: true });
    }
    const stub = join(cwd, 'packages/app/node_modules/prettier');
    mkdirSync(stub, { recursive: true });
    writeFileSync(join(stub, 'package.json'), '{"name":"prettier","type":"module","main":"index.js"}');
    writeFileSync(join(stub, 'index.js'), 'export const format = (s) => s;\nexport const resolveConfig = async () => null;\n');
    execFileSync('node', [join(cwd, 'packages/app/scripts/build-knowledge.mjs')], { stdio: 'ignore' });
    assert.deepEqual(
      docsOf(readFileSync(join(repo, file), 'utf8')),
      docsOf(readFileSync(join(cwd, file), 'utf8')),
      'knowledge-base.generated.ts is stale: run pnpm --dir packages/app run build:knowledge'
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('version-only manifest bumps are read from real git diffs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'budgero-ci-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '-A');
    git('-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const manifest = (v, extra = '') => `{\n  "name": "app",\n  "version": "${v}",\n  "scripts": {}${extra}\n}\n`;
  try {
    git('init', '-q');
    mkdirSync(join(cwd, 'packages/app'), { recursive: true });
    writeFileSync(join(cwd, 'packages/app/package.json'), manifest('1.0.0'));
    const base = commit();
    writeFileSync(join(cwd, 'packages/app/package.json'), manifest('1.0.1'));
    const bump = commit();
    assert.deepEqual(planEvent({ pull_request: { base: { sha: base }, head: { sha: bump } } }, cwd), none);
    assert.deepEqual(planEvent({ before: base, after: bump }, cwd), none);
    writeFileSync(join(cwd, 'packages/app/package.json'), manifest('1.0.1', ',\n  "type": "module"'));
    const real = commit();
    assert.deepEqual(planEvent({ before: base, after: real }, cwd), { ...none, app: true });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('real git ranges include every PR commit, deletions, and both sides of renames', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'budgero-ci-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '-A');
    git('-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    mkdirSync(join(cwd, 'packages/app'), { recursive: true });
    writeFileSync(join(cwd, 'packages/app/old.ts'), 'export const old = 1;\n');
    const base = commit();
    mkdirSync(join(cwd, 'packages/website'), { recursive: true });
    git('mv', 'packages/app/old.ts', 'packages/website/new.ts');
    commit();
    mkdirSync(join(cwd, 'packages/server'), { recursive: true });
    writeFileSync(join(cwd, 'packages/server/new.go'), 'package server\n');
    const head = commit();
    const expected = ['packages/app/old.ts', 'packages/server/new.go', 'packages/website/new.ts'];
    assert.deepEqual(changedPaths(base, head, true, cwd), expected);
    assert.deepEqual(changedPaths(base, head, false, cwd), expected);
    assert.deepEqual(planEvent({ pull_request: { base: { sha: base }, head: { sha: head } } }, cwd), all);
    assert.deepEqual(planEvent({ before: base, after: head }, cwd), all);
    assert.deepEqual(planEvent({ before: '0'.repeat(40), after: head }, cwd), all);
    assert.deepEqual(planEvent({ before: 'a'.repeat(40), after: head }, cwd), all);
    assert.deepEqual(planEvent({}, cwd), all);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});


test('actual required gate scripts reject failed, cancelled, and unexpectedly skipped builds', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const name of ['web', 'server']) {
    const job = workflow.split(`\n  ${name}:\n`)[1].split(/\n  [a-z-]+:\n/)[0];
    const script = job.split('        run: |\n')[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');
    for (const changes of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const checks of ['success', 'failure', 'cancelled', 'skipped']) {
        for (const selected of ['true', 'false']) {
          const result = spawnSync('bash', ['-e', '-c', script], {
            env: { ...process.env, CHANGES_RESULT: changes, CHECKS_RESULT: checks, SELECTED: selected },
          });
          const shouldPass = changes === 'success' && checks === (selected === 'true' ? 'success' : 'skipped');
          assert.equal(result.status === 0, shouldPass, `${name}: changes=${changes}, checks=${checks}, selected=${selected}`);
        }
      }
    }
  }
});
