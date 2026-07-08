# syntax=docker/dockerfile:1.6

# Multi-stage build for Budgero app for Fly.io
FROM node:22-alpine AS frontend-builder

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/app/package.json ./packages/app/

# Install dependencies with pnpm store cache
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# Copy source code after dependency installation
COPY packages/core ./packages/core/
COPY packages/runtime ./packages/runtime/
COPY packages/app ./packages/app/

# Build only what we need
WORKDIR /app

# Build‑time envs passed through to Vite (must start with VITE_)
# Clerk publishable key
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

# PostHog Cloud EU (public client-side key, baked into the bundle)
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

# Git short SHA of the build (git is unavailable in the build stage, so the
# release script passes it in; vite bakes it into the bundle as the Build id).
ARG APP_BUILD_SHA
ENV APP_BUILD_SHA=$APP_BUILD_SHA

# Build shared packages first (required by app)
RUN pnpm --filter @budgero/runtime build
RUN pnpm --filter @budgero/core build

# Build app package (run via pnpm workspace to avoid npx resolution issues in containers)
RUN pnpm --filter @budgero/app exec vite build

# Go builder stage
FROM golang:1.26.4-alpine AS go-builder

# Install build dependencies
RUN apk upgrade --no-cache && apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy Go module files
COPY packages/server/go.mod packages/server/go.sum ./

# Download dependencies with cache
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Copy Go source code
COPY packages/server/ ./

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/packages/app/dist ./dist

# Build the Go SaaS binary with cache
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o budgero-server ./cmd/saas

# Final stage - minimal runtime image
FROM alpine:3.21

# Install ca-certificates for HTTPS requests and wget for health checks
# Note: apk upgrade ensures we get the latest security patches (e.g., busybox CVEs)
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates tzdata wget

# Create non-root user
RUN addgroup -g 1001 -S budgero && \
    adduser -S budgero -u 1001 -G budgero

# Default server envs (override at runtime)
ENV DEMO_MODE=false \
    DEMO_ALLOWED_USER_ID= \
    DEMO_ALLOWED_USER_EMAIL=

# Set working directory
WORKDIR /app

# Copy the binary from builder stage
COPY --from=go-builder /app/budgero-server .

# Runtime entry to load offline signing key from a mounted file if provided
RUN echo '#!/bin/sh' > /app/start.sh \
  && echo 'set -e' >> /app/start.sh \
  && echo '' >> /app/start.sh \
  && echo '# If OFFLINE_ECDSA_PRIV_PATH is set and OFFLINE_ECDSA_PRIV_PEM is empty, load PEM from file' >> /app/start.sh \
  && echo 'if [ -n "${OFFLINE_ECDSA_PRIV_PATH}" ] && [ -z "${OFFLINE_ECDSA_PRIV_PEM}" ] && [ -f "${OFFLINE_ECDSA_PRIV_PATH}" ]; then' >> /app/start.sh \
  && echo '  export OFFLINE_ECDSA_PRIV_PEM="$(cat "${OFFLINE_ECDSA_PRIV_PATH}")"' >> /app/start.sh \
  && echo 'fi' >> /app/start.sh \
  && echo '' >> /app/start.sh \
  && echo '# Log demo mode if enabled' >> /app/start.sh \
  && echo 'if [ "${DEMO_MODE}" = "true" ]; then' >> /app/start.sh \
  && echo '  echo "[budgero] Starting in DEMO MODE (no persistence, offline disabled)."' >> /app/start.sh \
  && echo 'fi' >> /app/start.sh \
  && echo '' >> /app/start.sh \
  && echo 'exec ./budgero-server' >> /app/start.sh \
  && chmod +x /app/start.sh

# Create data directory for database
RUN mkdir -p /app/data && chown -R budgero:budgero /app

# Switch to non-root user
USER budgero

# Expose port
EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/v1/health || exit 1

# Run via entrypoint wrapper (handles OFFLINE_ECDSA_PRIV_PATH)
CMD ["/app/start.sh"]
