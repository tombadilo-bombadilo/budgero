#!/usr/bin/env bash
set -euo pipefail

PROJECT="budgero"
BUCKET_HOST="https://storage.googleapis.com/budgero_releases"
LATEST_POINTER="${BUCKET_HOST}/latest.txt"
INSTALL_DIR_DEFAULT="${HOME:-}/.local/bin"
INSTALL_DIR="${BUDGERO_INSTALL_DIR:-}"
INSTALL_DIR_USER_SET=false
if [ -n "$INSTALL_DIR" ]; then
  INSTALL_DIR_USER_SET=true
else
  INSTALL_DIR="$INSTALL_DIR_DEFAULT"
fi

usage() {
  cat <<'EOF'
Budgero self-host installer

Options (all optional):
  --version <tag>      Version tag to install (e.g. v1.0.4 or 1.0.4)
  --install-dir <dir>  Target directory for the budgero binary (default: ~/.local/bin)
  -h, --help           Show this message

Environment overrides:
  BUDGERO_INSTALL_DIR  Same as --install-dir
EOF
}

prefer_cmd() {
  if command -v curl >/dev/null 2>&1; then
    echo "curl -fsSL"
  elif command -v wget >/dev/null 2>&1; then
    echo "wget -qO-"
  else
    echo ""
  fi
}

FETCH_CMD="$(prefer_cmd)"
if [ -z "$FETCH_CMD" ]; then
  echo "error: install script needs either curl or wget" >&2
  exit 1
fi

fetch() {
  local url="$1"
  if [[ "$FETCH_CMD" == curl* ]]; then
    curl -fsSL "$url"
  else
    wget -qO- "$url"
  fi
}

download_binary() {
  local url="$1" dest="$2"
  if [[ "$FETCH_CMD" == curl* ]]; then
    if [ -t 1 ]; then
      curl -fSL --progress-bar "$url" -o "$dest"
    else
      curl -fSL "$url" -o "$dest"
    fi
  else
    if [ -t 1 ]; then
      wget --progress=dot:giga "$url" -O "$dest"
    else
      wget -q "$url" -O "$dest"
    fi
  fi
}

remote_exists() {
  local url="$1"
  if [[ "$FETCH_CMD" == curl* ]]; then
    curl -Ifs "$url" >/dev/null
  else
    wget --spider -q "$url"
  fi
}

VERSION=""
VERSION_EXPLICIT=false

while [ $# -gt 0 ]; do
  case "$1" in
    --version|-v)
      shift
      [ $# -gt 0 ] || { echo "--version expects a value" >&2; exit 1; }
      VERSION="$1"
      VERSION_EXPLICIT=true
      ;;
    --install-dir|-d)
      shift
      [ $# -gt 0 ] || { echo "--install-dir expects a value" >&2; exit 1; }
      INSTALL_DIR="$1"
      INSTALL_DIR_USER_SET=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [ -z "$VERSION" ]; then
  echo "Determining latest version..."
  CACHEBUST="$(date +%s)"
  if ! VERSION="$(fetch "${LATEST_POINTER}?cb=${CACHEBUST}" | tr -d '\r')"; then
    echo "error: unable to determine latest version from $LATEST_POINTER" >&2
    exit 1
  fi
fi

if [[ "$VERSION" != v* ]]; then
  VERSION="v${VERSION}"
fi

DOWNLOAD_PREFIX="${BUCKET_HOST}/latest"
if [ "$VERSION_EXPLICIT" = true ]; then
  DOWNLOAD_PREFIX="${BUCKET_HOST}/${VERSION}"
fi

if [ -z "$INSTALL_DIR" ]; then
  echo "error: install directory resolved to an empty path; set BUDGERO_INSTALL_DIR" >&2
  exit 1
fi

UNAME_S="$(uname -s)"
case "$UNAME_S" in
  Linux)
    OS="linux"
    ;;
  Darwin)
    OS="darwin"
    ;;
  *)
    echo "error: unsupported OS '$UNAME_S'. Only Linux and macOS are supported." >&2
    exit 1
    ;;
esac

UNAME_M="$(uname -m)"
case "$UNAME_M" in
  x86_64|amd64)
    ARCH="amd64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "error: unsupported architecture '$UNAME_M'." >&2
    exit 1
    ;;
esac

TARGET_BASE="${PROJECT}_${OS}_${ARCH}"
SUFFIXES=("")
if [ "$ARCH" = "amd64" ]; then
  SUFFIXES+=("_v1")
else
  SUFFIXES+=("_v8.0")
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
ARTIFACT=""

for suffix in "${SUFFIXES[@]}"; do
  CANDIDATE="${TARGET_BASE}${suffix}/${PROJECT}"
  URL="${DOWNLOAD_PREFIX}/${CANDIDATE}"
  if remote_exists "$URL"; then
    ARTIFACT="$URL"
    break
  fi
done

if [ -z "$ARTIFACT" ]; then
  echo "error: could not find an artifact for $OS/$ARCH at ${BUCKET_HOST}/${VERSION}/" >&2
  exit 1
fi

echo "Downloading ${PROJECT} ${VERSION} for ${OS}/${ARCH}..."
TARGET_PATH="${TMPDIR}/${PROJECT}"
download_binary "$ARTIFACT" "$TARGET_PATH"

chmod +x "$TARGET_PATH"

# Ensure install directory exists (without sudo unless the user explicitly requested it)
if ! mkdir -p "$INSTALL_DIR" >/dev/null 2>&1; then
  echo "error: unable to create $INSTALL_DIR; provide --install-dir or set BUDGERO_INSTALL_DIR" >&2
  exit 1
fi

DEST="${INSTALL_DIR}/${PROJECT}"
if [ ! -w "$INSTALL_DIR" ]; then
  echo "error: $INSTALL_DIR is not writable; provide --install-dir or set BUDGERO_INSTALL_DIR" >&2
  exit 1
fi

mv "$TARGET_PATH" "$DEST"

echo "Budgero ${VERSION} installed to ${DEST}"
echo "Run 'budgero serve' to start the server or 'budgero --help' for usage."

case ":${PATH}:" in
  *:"${INSTALL_DIR}":*) ;;
  *)
    echo "Note: ${INSTALL_DIR} is not on your PATH. Add it to PATH to launch budgero without a full path."
    ;;
esac
