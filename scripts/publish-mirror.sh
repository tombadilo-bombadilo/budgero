#!/usr/bin/env bash
#
# Publish master + the release tag to the public GitHub mirror.
#
# The canonical repository (Forgejo) keeps the full private history in the
# `pre-oss-history` branch. `master` was re-rooted at the open-source baseline
# commit for v1.5.0, so its history is public-safe and the mirror receives it
# as-is — real commits accumulate on GitHub from v1.5.0 onward.
#
# Safety:
#   - Only `master` and the named tag are ever pushed; other branches
#     (pre-oss-history included) never leave the canonical remote.
#   - Refuses to push if the private pre-open-source history is reachable
#     from master (e.g. via an accidental merge of pre-oss-history).
#   - Pushes are fast-forward only. Set FORCE=1 for the one-time cutover of a
#     mirror that still holds a legacy single-orphan snapshot.
#
# Usage:
#   scripts/publish-mirror.sh <mirror-remote-url> [tag]
#
#   tag defaults to v<version> from the root package.json.
#
set -euo pipefail

MIRROR_REMOTE="${1:?usage: publish-mirror.sh <mirror-remote-url> [tag]}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Root commit of the PRIVATE pre-open-source history (pre-oss-history
# branch). Every private commit descends from it, so if it is reachable from
# master, private history has leaked into the public lineage. Pinning the
# private root (instead of the public one) keeps this check independent of
# the public root's own hash — which contains this file.
PRIVATE_HISTORY_ROOT="77ab4d4dbca3acc8915510907843f703acca3d2d"

VERSION="$(node -p "require('./package.json').version")"
TAG="${2:-v$VERSION}"
if [[ -z "$TAG" ]]; then
  TAG="v$VERSION"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean — commit or stash first" >&2
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "error: tag $TAG does not exist — cut the release first" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "refs/tags/$TAG" master; then
  echo "error: tag $TAG is not on master" >&2
  exit 1
fi

# If the private root object is absent (e.g. a clone without pre-oss-history)
# it cannot be an ancestor, so a failing merge-base is a pass.
if git merge-base --is-ancestor "$PRIVATE_HISTORY_ROOT" master 2>/dev/null; then
  echo "error: master's lineage contains the private pre-open-source history" >&2
  echo "       (root $PRIVATE_HISTORY_ROOT is reachable). Refusing to publish." >&2
  exit 1
fi

PUSH_ARGS=()
if [[ "${FORCE:-}" == "1" ]]; then
  PUSH_ARGS+=(--force)
  echo "FORCE=1: overwriting mirror history (one-time cutover)"
fi

echo "Publishing master + $TAG to $MIRROR_REMOTE ..."
git push "${PUSH_ARGS[@]}" "$MIRROR_REMOTE" master:master
git push "$MIRROR_REMOTE" "refs/tags/$TAG"

echo "Done. Mirror is at $(git rev-parse --short master) ($TAG)."
