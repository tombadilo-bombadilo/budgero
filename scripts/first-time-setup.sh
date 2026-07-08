#!/bin/bash
set -e

echo "========================================"
echo "Budgero First Time Setup"
echo "========================================"
echo

# --- Prerequisites -----------------------------------------------------------

if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required. Install it from https://pnpm.io/installation"
    exit 1
fi

HAS_GO=1
if ! command -v go >/dev/null 2>&1; then
    HAS_GO=0
    echo "WARNING: Go not found — skipping backend setup (Air, Go modules)."
    echo "         Install Go 1.26+ from https://go.dev/dl/ to run the API server."
    echo
fi

# --- JS workspace ------------------------------------------------------------

echo "Installing dependencies..."
pnpm install

echo
echo "Building runtime package..."
(cd packages/runtime && pnpm run build)

echo
echo "Building core package..."
(cd packages/core && pnpm run build)

# --- Go backend --------------------------------------------------------------

if [ "$HAS_GO" -eq 1 ]; then
    echo
    echo "Installing Air for hot reloading (Go)..."
    go install github.com/air-verse/air@latest || {
        echo "Failed to install Air. Make sure GOPATH/bin is in your PATH."
        exit 1
    }

    echo
    echo "Downloading Go server dependencies..."
    (cd packages/server && go mod download)
fi

# --- Done --------------------------------------------------------------------

echo
echo "========================================"
echo "Setup completed successfully!"
echo "========================================"
echo
echo "Start developing with:"
echo "  pnpm run dev:selfhost  # Self-host mode (frontend + Go server) — works out of the box"
echo "  pnpm run dev:website   # Marketing website"
echo
echo "Cloud (SaaS) flavor development:"
echo "  pnpm run dev:cloud     # Requires VITE_CLERK_PUBLISHABLE_KEY in packages/app/.env.local"
echo "                         # (a Clerk dev instance of your own) — otherwise use dev:selfhost."
echo
