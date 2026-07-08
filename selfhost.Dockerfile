# syntax=docker/dockerfile:1.6

### Stage 1: Build Frontend
# --platform=$BUILDPLATFORM: the JS bundle is architecture-independent, so it
# always builds natively on the build host. In a multi-platform build this
# stage runs ONCE and is shared by every target instead of being re-built
# under QEMU emulation per architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder

WORKDIR /app

RUN npm install -g pnpm

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/runtime/package.json packages/runtime/
COPY packages/app/package.json packages/app/

# Install dependencies with pnpm store cache
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# Copy source
COPY packages/core ./packages/core
COPY packages/runtime ./packages/runtime
COPY packages/app ./packages/app

# Build runtime package (required by app)
RUN pnpm --filter @budgero/runtime build

# Build core package
RUN pnpm --filter @budgero/core build

# Git short SHA of the build (git is unavailable in the build stage, so the
# release script passes it in; vite bakes it into the bundle as the Build id).
ARG APP_BUILD_SHA
ENV APP_BUILD_SHA=$APP_BUILD_SHA

# Build self-host frontend (run via pnpm workspace to avoid npx resolution issues in containers)
RUN VITE_SELF_HOSTABLE=true pnpm --filter @budgero/app exec vite build


### Stage 2: Build Go Server
# --platform=$BUILDPLATFORM + GOOS/GOARCH: Go cross-compiles natively, so the
# compiler never runs under QEMU even when targeting another architecture.
FROM --platform=$BUILDPLATFORM golang:1.26.4-alpine AS server-builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go modules first for caching
COPY packages/server/go.mod packages/server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Copy server source
COPY packages/server/ ./

# Copy frontend build for embedding (must be in dist/ for go:embed)
COPY --from=frontend-builder /app/packages/app/dist ./dist

# Build static binary from selfhost entrypoint, cross-compiled for the
# target platform of this build.
ARG TARGETOS TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o budgero ./cmd/selfhost


### Stage 3: Runtime
FROM alpine:3.21 AS runtime

# Note: apk upgrade ensures we get the latest security patches (e.g., busybox CVEs)
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN addgroup -g 1001 -S budgero && \
    adduser -S budgero -u 1001 -G budgero

WORKDIR /app

# Copy binary
COPY --from=server-builder /app/budgero /app/budgero

# Create data directory for SQLite with proper ownership
RUN mkdir -p /data && chown -R budgero:budgero /data /app

# Environment defaults
ENV PORT=3001
ENV SELF_HOSTABLE=true
ENV DB_PATH=/data/budgero.db

# Switch to non-root user
USER budgero

EXPOSE 3001

VOLUME ["/data"]

ENTRYPOINT ["/app/budgero"]
CMD ["serve"]
