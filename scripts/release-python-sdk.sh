#!/usr/bin/env bash
# Build and publish the Budgero Python SDK to PyPI or TestPyPI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SDK_DIR="${REPO_ROOT}/packages/sdk-python"
DIST_DIR="${SDK_DIR}/dist"

# Load .env if present (for TWINE_USERNAME / TWINE_PASSWORD / TWINE_REPOSITORY)
if [ -f "${REPO_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

REPOSITORY="${TWINE_REPOSITORY:-pypi}" # use "testpypi" to publish to TestPyPI

cd "${SDK_DIR}"

echo "==> Using repository: ${REPOSITORY}"
echo "==> SDK directory: ${SDK_DIR}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required on PATH" >&2
  exit 1
fi

# Ensure build tools are present (installs into the current environment)
python3 -m pip install --upgrade pip >/dev/null
python3 -m pip install --upgrade build twine >/dev/null

echo "==> Cleaning old artifacts"
rm -rf "${DIST_DIR}" "${SDK_DIR}/build" "${SDK_DIR}/budgero.egg-info"

echo "==> Building sdist and wheel"
python3 -m build

echo "==> Verifying metadata"
python3 -m twine check "${DIST_DIR}"/*

cat <<'EOF'
============================================================
 Ready to upload. Ensure you have credentials set, e.g.:
   export TWINE_USERNAME="__token__"
   export TWINE_PASSWORD="pypi-<your-api-token>"
 To publish to TestPyPI instead:
   export TWINE_REPOSITORY="testpypi"
============================================================
EOF

read -r -p "Upload artifacts to ${REPOSITORY}? [y/N] " answer
case "${answer}" in
  [Yy]*)
    echo "==> Uploading"
    python3 -m twine upload --repository "${REPOSITORY}" "${DIST_DIR}"/*
    ;;
  *)
    echo "Upload skipped."
    ;;
esac

echo "Done."
