#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
    const buildDir = readdirSync(path.join(root, 'dist')).find((entry) =>
      entry.startsWith(`budgero_linux_${arch}`)
    );
    if (!buildDir) {
      throw new Error(`No goreleaser build for linux/${arch} under dist/ — run goreleaser first.`);
    }
    mkdirSync(path.join(stageDir, arch), { recursive: true });
    const staged = path.join(stageDir, arch, 'budgero');
    copyFileSync(path.join(root, 'dist', buildDir, 'budgero'), staged);
    chmodSync(staged, 0o755);
  }

  console.log(`\n==> Building and pushing Docker image: ${DOCKER_IMAGE}:${tag}`);
  console.log(`==> Build engine: ${useDepot ? 'Depot' : 'Docker Buildx'}`);

  // Login to Docker Hub
  run(`echo "${DOCKER_TOKEN}" | docker login -u "${DOCKER_USERNAME}" --password-stdin`);

  if (!useDepot) {
    // Create buildx builder if needed (ignore error if exists)
    tryRun('docker buildx create --name budgero-builder --use 2>/dev/null || docker buildx use budgero-builder');
  }

  const buildCmd = useDepot ? 'depot build' : 'docker buildx build';
  const isPrerelease = tag.includes('-');
  const imageTags = [`--tag ${DOCKER_IMAGE}:${tag}`];
  if (!isPrerelease) imageTags.push(`--tag ${DOCKER_IMAGE}:latest`);

  // Single multi-platform invocation: buildx assembles and pushes the
  // manifest list directly, no per-arch tags or imagetools step needed.
  run(
    `${buildCmd} --platform ${DOCKER_PLATFORMS.join(',')} --provenance=false --sbom=false ${imageTags.join(' ')} --push -f selfhost.release.Dockerfile ${stageDir}`
  );

  console.log(`==> Docker image pushed: ${DOCKER_IMAGE}:${tag}`);
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

  let createdTag = false;
  const existingTag = runCapture(`git tag --list ${tag}`);
  if (existingTag) {
    const tagCommit = runCapture(`git rev-list -n 1 ${tag}`);
    const headCommit = runCapture('git rev-parse HEAD');
    if (tagCommit === headCommit) {
      console.log(`\n==> Tag ${tag} already exists on HEAD; reusing it.`);
    } else {
      console.log(`\n==> Moving ${tag} to current HEAD`);
      run(`git tag -f ${tag}`);
      createdTag = true;
    }
  } else {
    console.log(`\n==> Tagging repository (${tag})`);
    run(`git tag ${tag}`);
    createdTag = true;
  }

  console.log(`\n==> Building release artifacts for ${tag}`);
  try {
    run('goreleaser build --clean');
  } catch (err) {
    console.error('GoReleaser failed; cleaning up.');
    if (createdTag) {
      run(`git tag -d ${tag}`);
    }
    throw err;
  }

  const distDir = path.join(root, 'dist');
  if (!existsSync(distDir)) {
    console.error('dist/ directory not found. Aborting release.');
    if (createdTag) {
      run(`git tag -d ${tag}`);
    }
    process.exit(1);
  }
  const artifacts = readdirSync(distDir).filter((entry) => !entry.startsWith('.'));
  if (artifacts.length === 0) {
    console.error('No artifacts produced under dist/. Aborting release.');
    if (createdTag) {
      run(`git tag -d ${tag}`);
    }
    process.exit(1);
  }

  const bucket = 'budgero_releases';
  const bucketUri = `gs://${bucket}`;
  console.log(`\n==> Ensuring ${bucketUri} allows public downloads`);
  if (!tryRun(`gsutil iam ch allUsers:objectViewer ${bucketUri}`)) {
    console.warn('   (warning: failed to set public IAM; ensure bucket is world-readable or installs will fail)');
  }

  const dest = `${bucketUri}/${tag}/`;
  console.log(`\n==> Uploading artifacts to ${dest}`);
  run(`gcloud storage cp --recursive dist/* ${dest}`);

  const latestDest = `${bucketUri}/latest/`;
  console.log(`\n==> Refreshing ${latestDest}`);
  run(`gcloud storage rsync --recursive --delete-unmatched-destination-objects dist ${latestDest}`);

  console.log('\n==> Updating latest release pointer');
  run(`printf %s ${tag} | gcloud storage cp --cache-control="no-store" - ${bucketUri}/latest.txt`);

  // Build and push Docker image
  await buildAndPushDocker(tag);

  console.log('\nAll artifacts uploaded. Remember to push your tag:');
  console.log(`  git push origin ${tag}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
