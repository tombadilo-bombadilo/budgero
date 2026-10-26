#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertReleaseTag, dockerLogin } from './release-common.mjs';

const dryRun = process.argv.includes('--dry-run');

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Load env from .config/release.env if it exists
const envFile = path.join(root, '.config', 'release.env');
if (existsSync(envFile)) {
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// Docker Hub config
const DOCKER_USERNAME = process.env.DOCKER_USERNAME || 'budgero';
const DOCKER_TOKEN = process.env.DOCKER_TOKEN;
const DOCKER_IMAGE = `${DOCKER_USERNAME}/cloud`;
const DOCKER_PLATFORMS = (process.env.DOCKER_PLATFORMS || 'linux/amd64,linux/arm64')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
// Client-side publishable keys for the hosted SaaS build; provided by the
// release environment (CI), not the repo.
const VITE_CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY || '';
const VITE_POSTHOG_KEY = process.env.VITE_POSTHOG_KEY || '';
const VITE_POSTHOG_HOST = process.env.VITE_POSTHOG_HOST || '';
// Optional PostHog source map upload (error tracking); see app.Dockerfile.
const POSTHOG_CLI_TOKEN = process.env.POSTHOG_CLI_TOKEN || '';
const POSTHOG_CLI_ENV_ID = process.env.POSTHOG_CLI_ENV_ID || '';

/** Docker args for the source map step. Missing secrets skip it, never fail. */
function sourcemapBuildArgs() {
  // A dry run checks the step without credentials and sends nothing.
  if (dryRun) return ['--build-arg POSTHOG_SOURCEMAPS=verify'];
  if (!POSTHOG_CLI_TOKEN || !POSTHOG_CLI_ENV_ID) {
    console.log(
      '::notice title=PostHog source maps::POSTHOG_CLI_TOKEN or POSTHOG_CLI_ENV_ID is not set; building without the source map upload.'
    );
    return [];
  }
  // Values are read by buildx from the environment, not put on the command line.
  return [
    '--build-arg POSTHOG_SOURCEMAPS=upload',
    '--secret id=posthog_cli_token,env=POSTHOG_CLI_TOKEN',
    '--secret id=posthog_cli_env_id,env=POSTHOG_CLI_ENV_ID',
  ];
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: root, shell: true, ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { stdio: 'pipe', cwd: root, shell: true }).toString().trim();
}

function tryRun(cmd) {
  try {
    run(cmd);
    return true;
  } catch (err) {
    return false;
  }
}

const useDepot = (() => {
  try {
    execSync('depot --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

async function buildAndPushDocker(tag) {
  if (!DOCKER_TOKEN) {
    console.error('DOCKER_TOKEN is required for SaaS release');
    process.exit(1);
  }

  if (!VITE_CLERK_PUBLISHABLE_KEY) {
    console.error('VITE_CLERK_PUBLISHABLE_KEY is required for SaaS release');
    process.exit(1);
  }

  console.log(`\n==> Building and pushing Docker image: ${DOCKER_IMAGE}:${tag}`);
  console.log(`==> Build engine: ${useDepot ? 'Depot' : 'Docker Buildx'}`);

  // Login to Docker Hub
  dockerLogin(DOCKER_USERNAME, DOCKER_TOKEN);

  if (!useDepot) {
    // Create buildx builder if needed (ignore error if exists)
    tryRun(
      'docker buildx create --name budgero-builder --use 2>/dev/null || docker buildx use budgero-builder'
    );
  }

  const buildCmd = useDepot ? 'depot build' : 'docker buildx build';
  const buildSha = runCapture('git rev-parse --short HEAD');
  const buildArgs = [
    `--build-arg VITE_CLERK_PUBLISHABLE_KEY="${VITE_CLERK_PUBLISHABLE_KEY}"`,
    `--build-arg VITE_POSTHOG_KEY="${VITE_POSTHOG_KEY}"`,
    `--build-arg VITE_POSTHOG_HOST="${VITE_POSTHOG_HOST}"`,
    `--build-arg APP_BUILD_SHA="${buildSha}"`,
    ...sourcemapBuildArgs(),
  ].join(' ');
  const archTags = [];
  for (const platform of DOCKER_PLATFORMS) {
    const arch = platform.split('/')[1] || platform.replace('/', '-');
    const archTag = `${DOCKER_IMAGE}:${tag}-${arch}`;
    archTags.push(archTag);
    console.log(`==> Building Docker image for ${platform}: ${archTag}`);
    run(
      `${buildCmd} --pull --no-cache-filter runtime --platform ${platform} ${buildArgs} --provenance=false --sbom=false --tag ${archTag} ${dryRun ? '--load' : '--push'} -f app.Dockerfile .`
    );
    if (!useDepot) tryRun('docker builder prune -af');
  }

  if (dryRun) {
    console.log('SaaS image verified locally; nothing published.');
    return;
  }

  // Create multi-arch manifest tags from per-arch images
  const isPrerelease = tag.includes('-');
  const manifestTags = [`--tag ${DOCKER_IMAGE}:${tag}`];
  if (!isPrerelease) manifestTags.push(`--tag ${DOCKER_IMAGE}:latest`);
  run(`docker buildx imagetools create ${manifestTags.join(' ')} ${archTags.join(' ')}`);

  console.log(`==> Docker image pushed: ${DOCKER_IMAGE}:${tag}`);
}

async function main() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;

  const dirty = runCapture('git status --porcelain');
  if (dirty) {
    console.error('\nRelease aborted: git working tree has uncommitted changes.');
    console.error('\n=== Dirty files (git status --porcelain) ===');
    console.error(dirty);
    console.error('\n=== Full git status ===');
    try {
      console.error(runCapture('git status'));
    } catch {
      /* ignore secondary failure */
    }
    console.error('=========================================\n');
    process.exit(1);
  }

  if (!dryRun) assertReleaseTag(tag, root);

  // Build and push Docker image
  await buildAndPushDocker(dryRun ? `${tag}-verification` : tag);

  console.log(`\n==> SaaS release complete: ${DOCKER_IMAGE}:${tag}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
