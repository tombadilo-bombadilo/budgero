#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertReleaseTag, dockerLogin, findLinuxBinary } from './release-common.mjs';

const dryRun = process.argv.includes('--dry-run');

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Docker Hub config
const DOCKER_USERNAME = process.env.DOCKER_USERNAME || 'budgero';
const DOCKER_TOKEN = process.env.DOCKER_TOKEN;
const DOCKER_IMAGE = `${DOCKER_USERNAME}/budgero`;
const DOCKER_PLATFORMS = (process.env.DOCKER_PLATFORMS || 'linux/amd64,linux/arm64')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

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
    console.log('\n==> Skipping Docker build (DOCKER_TOKEN not set)');
    return;
  }

  // Stage the goreleaser-built linux binaries (frontend embedded, version
  // stamped) into a tiny per-arch build context. The image build then only
  // runs the runtime stage — no Node/Go toolchain under QEMU emulation,
  // which is what used to make multi-arch publishes take ~20 minutes.
  console.log('\n==> Staging goreleaser binaries for Docker');
  const stageDir = path.join(root, 'dist', 'docker');
  rmSync(stageDir, { recursive: true, force: true });
  for (const platform of DOCKER_PLATFORMS) {
    const arch = platform.split('/')[1] || platform.replace('/', '-');
    const binary = findLinuxBinary(path.join(root, 'dist'), arch);
    mkdirSync(path.join(stageDir, arch), { recursive: true });
    const staged = path.join(stageDir, arch, 'budgero');
    copyFileSync(binary, staged);
    chmodSync(staged, 0o755);
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
  const isPrerelease = tag.includes('-');
  const imageTags = [`--tag ${DOCKER_IMAGE}:${tag}`];
  if (!dryRun && !isPrerelease) imageTags.push(`--tag ${DOCKER_IMAGE}:latest`);

  // Single multi-platform invocation: buildx assembles and pushes the
  // manifest list directly, no per-arch tags or imagetools step needed.
  run(
    `${buildCmd} --pull --no-cache-filter runtime --platform ${DOCKER_PLATFORMS.join(',')} --provenance=false --sbom=false ${imageTags.join(' ')} ${dryRun ? '--output type=oci,dest=dist/selfhost-verification.oci.tar' : '--push'} -f selfhost.release.Dockerfile ${stageDir}`
  );

  console.log(`==> Docker image ${dryRun ? 'verified locally' : 'pushed'}: ${DOCKER_IMAGE}:${tag}`);
}

async function main() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;

  const dirty = runCapture('git status --porcelain');
  if (dirty) {
    console.error('Release aborted: git working tree has uncommitted changes.');
    process.exit(1);
  }

  if (!dryRun) assertReleaseTag(tag, root);
  if (!DOCKER_TOKEN) throw new Error('DOCKER_TOKEN is required');
  console.log(`Building release artifacts for ${tag}${dryRun ? ' (verification only)' : ''}`);
  run(`goreleaser release --clean --skip=publish${dryRun ? ' --snapshot' : ''}`);
  if (!existsSync(path.join(root, 'dist', 'checksums.txt'))) {
    throw new Error('GoReleaser did not produce checksums.txt');
  }
  if (dryRun) {
    await buildAndPushDocker(`${tag}-verification`);
    console.log('Release verification complete; nothing published and no tags changed.');
    return;
  }

  const bucket = 'budgero_releases';
  const bucketUri = `gs://${bucket}`;
  console.log(`\n==> Ensuring ${bucketUri} allows public downloads`);
  if (!tryRun(`gsutil iam ch allUsers:objectViewer ${bucketUri}`)) {
    console.warn(
      '   (warning: failed to set public IAM; ensure bucket is world-readable or installs will fail)'
    );
  }

  const dest = `${bucketUri}/${tag}/`;
  console.log(`\n==> Uploading artifacts to ${dest}`);
  // Only what installers and the self-host updater download: the raw binaries
  // and metadata. The .zip archives are on the GitHub release; storing them
  // here too (and a second full copy under latest/) tripled what every
  // release wrote to the multi-region bucket.
  run(`gcloud storage rsync --recursive --exclude='.*\\.zip$' dist ${dest}`);

  if (!tag.includes('-')) {
    run(
      `printf %s ${tag} | gcloud storage cp --cache-control="no-store" - ${bucketUri}/latest.txt`
    );
  }

  // Build and push Docker image
  await buildAndPushDocker(tag);

  console.log('\nAll artifacts uploaded. Remember to push your tag:');
  console.log(`  git push origin ${tag}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
