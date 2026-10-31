import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const all = () => ({ app: true, website: true, server: true });

/** Package manifests whose `"version"` line a release bumps. */
const VERSION_MANIFESTS = new Set([
  'package.json',
  'packages/app/package.json',
  'packages/server/package.json',
  'packages/website/package.json',
]);
const VERSION_LINE = /^\s*"version":\s*"[^"]*",?\s*$/;
// Release-only files: the server's version string and the assistant's
// knowledge base, generated from the docs (kept in sync by changes.test.mjs,
// which runs on every event).
const NO_CHECK_FILES = new Set([
  'packages/server/internal/appmeta/version.txt',
  'packages/app/src/features/ai/lib/knowledge/knowledge-base.generated.ts',
]);

/** True when every added/removed line of a manifest is its `"version"` field. */
export function isVersionOnlyChange(lines) {
  return Array.isArray(lines) && lines.length > 0 && lines.every((line) => VERSION_LINE.test(line));
}

/**
 * `changedLines(path)` returns the added/removed lines of a file (without the
 * +/- marker), or null when unknown; unknown always counts as a real change.
 */
export function planChanges(paths, changedLines = () => null) {
  const plan = { app: false, website: false, server: false };
  for (const path of paths) {
    if (NO_CHECK_FILES.has(path)) continue;
    if (VERSION_MANIFESTS.has(path) && isVersionOnlyChange(changedLines(path))) continue;
    // The classifier is tested by the changes job itself on every event.
    if (path === 'scripts/ci/changes.mjs' || path === 'scripts/ci/changes.test.mjs') continue;
    // Dependency patches affect the shared workspace installation.
    if (path.startsWith('packages/website/patches/')) return all();
    // The web job invokes the server's package.json build script too.
    if (path === 'packages/server/package.json') {
      plan.app = true;
      plan.server = true;
      continue;
    }
    if (path.startsWith('packages/website/') || path === 'scripts/i18n/audit-website.mjs') {
      plan.website = true;
    } else if (/^packages\/(app|core|runtime|eslint-config)\//.test(path) || path.startsWith('scripts/i18n/')) {
      plan.app = true;
    } else if (path.startsWith('packages/server/')) {
      plan.server = true;
    } else if (
      /^(README|CONTRIBUTING|SECURITY)\.md$/.test(path) ||
      /^docs\/.*\.md$/.test(path) ||
      path.startsWith('.github/ISSUE_TEMPLATE/') ||
      path === '.github/PULL_REQUEST_TEMPLATE.md' ||
      path === '.github/FUNDING.yml' ||
      /^LICENSE(\.md)?$/.test(path)
    ) {
      // Repository prose, templates, and metadata have no build consumers.
    } else if (/^\.github\/workflows\/(?!ci\.yml$)[^/]+\.ya?ml$/.test(path)) {
      // Other workflows (release, runner checks) are not exercised by these
      // checks; ci.yml itself still runs everything to validate its jobs.
    } else {
      // Workflow, lockfile, tooling, shared configuration, and unknown paths
      // retain the full existing check set rather than risking a missed consumer.
      return all();
    }
  }
  return plan;
}

export function changedPaths(base, head, pullRequest, cwd = process.cwd()) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha))) {
    return null;
  }
  try {
    // PRs use the entire merge-base diff; pushes use the complete before/after
    // range. Disable rename detection so both old and new consumers are checked.
    const range = `${base}${pullRequest ? '...' : '..'}${head}`;
    return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range, '--'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0').filter(Boolean);
  } catch {
    // A force push or unavailable base must run all checks, never skip them.
    return null;
  }
}

/** Added/removed lines of one file in the range, or null if git can't say. */
export function changedLinesOf(base, head, pullRequest, path, cwd = process.cwd()) {
  try {
    const range = `${base}${pullRequest ? '...' : '..'}${head}`;
    return execFileSync('git', ['diff', '--no-renames', '-U0', range, '--', path], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
      .map((line) => line.slice(1));
  } catch {
    return null;
  }
}

export function planEvent(event, cwd) {
  const pr = event.pull_request;
  const base = pr?.base.sha ?? event.before;
  const head = pr?.head.sha ?? event.after;
  const paths = changedPaths(base, head, Boolean(pr), cwd);
  return paths === null
    ? all()
    : planChanges(paths, (path) => changedLinesOf(base, head, Boolean(pr), path, cwd));
}

/** Git tree of a commit: the exact content CI checks, independent of history. */
export function treeOf(sha, cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', `${sha}^{tree}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export const passedArtifactName = (tree) => `ci-passed-${tree}`;

/**
 * True when a pull request from this repository already passed every CI gate
 * on exactly this tree (its `record-pass` job uploads a marker artifact named
 * after the tree). A merge commit whose tree matches what the PR tested — the
 * usual case when master didn't move in between — needs no second run.
 * Any doubt (API error, fork run, expired marker, different tree) means run.
 */
export async function alreadyPassed({ tree, repository, repositoryId, token, fetchImpl = fetch }) {
  if (!tree || !/^[a-f0-9]{40}$/.test(tree) || !repository || !repositoryId || !token) return false;
  try {
    const url = `https://api.github.com/repos/${repository}/actions/artifacts?name=${passedArtifactName(tree)}&per_page=20`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return false;
    const { artifacts = [] } = await response.json();
    return artifacts.some(
      (artifact) =>
        artifact.name === passedArtifactName(tree) &&
        !artifact.expired &&
        artifact.workflow_run?.head_repository_id === repositoryId
    );
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const isPush = !event.pull_request;
  const tree = treeOf(isPush ? event.after : 'HEAD');
  let plan = planEvent(event);
  if (
    isPush &&
    (plan.app || plan.website || plan.server) &&
    (await alreadyPassed({
      tree,
      repository: process.env.GITHUB_REPOSITORY,
      repositoryId: event.repository?.id,
      token: process.env.GH_TOKEN,
    }))
  ) {
    console.log(`Tree ${tree} already passed CI on its pull request; skipping the checks.`);
    plan = { app: false, website: false, server: false };
  }
  const output =
    Object.entries(plan).map(([key, value]) => `${key}=${value}`).join('\n') + `\ntree=${tree ?? ''}\n`;
  appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(output);
}
