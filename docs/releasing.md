# Releasing Budgero

GitHub is the primary repository. Pull requests, CI, version tags, and public
release pages live at `tombadilo-bombadilo/budgero`. Release builds run on the
isolated Dell VM; outside-contributor PR checks run on GitHub-hosted runners.
Forgejo is not part of publishing. Its private historical branches remain intact.

## Prepare a version

1. Create a branch from current `origin/master`.
2. Review changes since the latest release and agree on the version and user-facing
   changelog. Keep the root, app, and server package versions and
   `packages/server/internal/appmeta/version.txt` in sync.
3. Add the approved entry to `packages/website/src/lib/changelog-data.ts` with exactly
   one `isLatest` entry. GitHub notes use this same source. Future/coming-soon items
   are excluded; contributor acknowledgements are included.
4. Run both `pnpm run security:deps` and `pnpm run security:go` after changing release
   metadata, before committing. Resolve actionable findings. Also run relevant tests.
5. Commit, push the branch, open a PR, and wait for required
   checks. Merge the PR. Another person's approval is not required.
6. Fetch `master` and wait for its CI to pass. Create an annotated tag at the exact
   merged release commit (not an obsolete pre-squash branch commit):

   ```sh
   git switch master
   git pull --ff-only origin master
   git tag -a vX.Y.Z -m 'Budgero vX.Y.Z' <release-commit-sha>
   git push origin refs/tags/vX.Y.Z
   ```

Pushing a version tag starts publication. Never move or force-push a published tag.
The publisher requires the tag to match `package.json` and the checked-out commit,
and requires that commit to be on `master` with passing `web` and `server` checks.
The CI gate runs on a GitHub-hosted runner, so it cannot block the Dell runner while
waiting for that same runner to finish CI.

## What gets published

The single **release** workflow runs dependency and Go vulnerability scans, then:

1. Builds Linux, macOS, and Windows binaries for amd64 and arm64, six ZIP archives,
   and SHA-256 checksums.
2. Uploads the binary layout (no `.zip` archives; those are on the GitHub release) to
   `gs://budgero_releases/vX.Y.Z/`. Stable versions also update `latest.txt`, which the
   installers and the self-host updater read to find the versioned folder.
3. Publishes `budgero/budgero:vX.Y.Z` for amd64/arm64 and `budgero/cloud:vX.Y.Z` for
   amd64. Stable versions update Docker `latest`; prereleases do not.
4. Creates a draft GitHub Release, uploads the six archives and `checksums.txt`, and
   publishes it with the curated changelog after both image publishers succeeded.
   Prerelease tags produce prerelease pages and are not marked latest.

No new release is created merely by merging code. Do not republish an older version
just to test the pipeline.

## Verify without publishing

In GitHub **Actions → release → Run workflow**, select `master` and leave
**dry_run** checked. The `production` environment permits `master` for this check.
It verifies required secrets, Google Cloud bucket listing and Docker login, runs
both scanners, builds all archives and Docker images locally, and uploads a
workflow artifact containing the archives, checksums and preview notes (7-day
retention). It does not create/move tags, push images, write to the Google bucket,
or create a GitHub Release. Snapshot binaries are verification builds, not releases.
Read access and login checks do not prove that every remote write permission works;
publication is only fully exercised by an actual approved release.

## Configuration

The `production` environment needs these secrets:

- `DOCKER_TOKEN` (Docker Hub account `budgero`, permission to push both repositories)
- `GCP_SERVICE_ACCOUNT_KEY` (complete JSON key, release bucket access)
- `GCP_PROJECT_ID`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_POSTHOG_KEY`
- `VITE_POSTHOG_HOST`

`DELL_RELEASES_ENABLED=true` enables publication for version-tag runs. Set it to
`false` to stop future publication jobs; this does not stop a job already running.
Dry-run verification remains available. GitHub Release API access uses the job's
short-lived `GITHUB_TOKEN` with `contents: write`; no personal token is needed.
Local Docker and Google authentication files are removed when the job finishes.

`DELL_RUNNER_ENABLED=true` routes `master` CI to the Dell. See
[runner operations](../infra/github-runner/README.md) for VM details and recovery.

## Failures and retries

Check the failed step before retrying the same tag. A failure can leave a versioned
Google upload or Docker image published even if no GitHub Release appeared; these
services do not share an atomic transaction. Never fix a failure by moving a tag.
Use a new version when released code needs correction.

For a transient failure, rerun the failed workflow using its original tag and commit.
An incomplete GitHub draft can be retried; its assets are replaced before publication.
A published GitHub Release is not overwritten by the script. Dry-run builds never
update production destinations. Avoid rerunning old stable tags: the publisher also
updates `latest` pointers. Rollbacks require a deliberate separate decision.
