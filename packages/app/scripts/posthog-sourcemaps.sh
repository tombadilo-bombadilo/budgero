#!/bin/sh
# PostHog error tracking source maps for the SaaS image (run by app.Dockerfile).
#
#   posthog-sourcemaps.sh <dist> <off|verify|upload> <release-version>
#
#   off     nothing to do; only checks that dist holds no .map files.
#   verify  release dry run: fetch the pinned CLI and run it with --dry-run
#           (no credentials, nothing sent).
#   upload  inject PostHog chunk ids into the JS, upload the maps to PostHog EU.
#           Credentials come from BuildKit secrets (never stored in a layer):
#           /run/secrets/posthog_cli_token (personal API key) and
#           /run/secrets/posthog_cli_env_id (project id).
#
# verify/upload expect dist built with APP_SOURCEMAPS=hidden. In every mode the
# maps are deleted afterwards and the script fails if any is left, so they are
# never served. In upload mode any failure (CLI download, inject, upload, no
# release id in the bundle) fails the build: a Cloud release without symbols is
# blind for its whole life (v1.19.4 shipped that way), so it is not a release.
set -eu

dist=$1
mode=$2
version=$3

CLI_VERSION=0.18.10
case "$(uname -m)" in
  x86_64) arch=x86_64 sum=d4507f08a29e8e89e79c3430841f9da5e2216983e231c219f30c69f4c7ac8c97 ;;
  aarch64) arch=aarch64 sum=5b0b26378a3edc4b2de0250c924606f559cfba4f5f2898d8e89b76c8624f1863 ;;
  *) arch='' sum='' ;;
esac

count_maps() { find "$dist" -name '*.map' -type f | wc -l | tr -d ' '; }

if [ "$mode" = verify ] || [ "$mode" = upload ]; then
  echo "==> PostHog source maps ($mode): $(count_maps) maps in $dist"
  tmp=$(mktemp -d)
  name="posthog-cli-$arch-unknown-linux-musl"
  if [ -n "$arch" ] \
    && wget -q -O "$tmp/cli.tar.gz" \
      "https://github.com/PostHog/posthog/releases/download/posthog-cli/v$CLI_VERSION/$name.tar.gz" \
    && echo "$sum  $tmp/cli.tar.gz" | sha256sum -c - >/dev/null \
    && tar -xzf "$tmp/cli.tar.gz" -C "$tmp"; then
    cli="$tmp/$name/posthog-cli"
    release="--release-name budgero-app --release-version $version"
    if [ "$mode" = verify ]; then
      # shellcheck disable=SC2086
      "$cli" --dry-run sourcemap process --directory "$dist" $release \
        || { echo "ERROR: posthog-cli dry run failed" >&2; exit 1; }
    else
      POSTHOG_CLI_API_KEY=$(cat /run/secrets/posthog_cli_token)
      POSTHOG_CLI_PROJECT_ID=$(cat /run/secrets/posthog_cli_env_id)
      export POSTHOG_CLI_API_KEY POSTHOG_CLI_PROJECT_ID
      # shellcheck disable=SC2086
      if "$cli" --host https://eu.posthog.com sourcemap inject --directory "$dist" $release \
        && "$cli" --host https://eu.posthog.com sourcemap upload --directory "$dist" $release --delete-after; then
        injected=$(grep -l '_posthogReleaseId' "$dist"/assets/*.js 2>/dev/null | wc -l | tr -d ' ')
        if [ "$injected" = 0 ]; then
          echo "ERROR: no chunk carries a PostHog release id after inject" >&2
          exit 1
        fi
        echo "==> PostHog source maps uploaded for budgero-app@$version ($injected chunks)"
      else
        echo "ERROR: PostHog source map inject/upload failed" >&2
        exit 1
      fi
      unset POSTHOG_CLI_API_KEY POSTHOG_CLI_PROJECT_ID
    fi
  else
    echo "ERROR: could not fetch posthog-cli $CLI_VERSION" >&2
    exit 1
  fi
  rm -rf "$tmp"
fi

# The maps must never be served: delete whatever is left and prove it.
find "$dist" -name '*.map' -type f -delete
left=$(count_maps)
if [ "$left" != 0 ]; then
  echo "ERROR: $left source maps left in $dist" >&2
  exit 1
fi
echo "==> Source maps in $dist after cleanup: 0"
