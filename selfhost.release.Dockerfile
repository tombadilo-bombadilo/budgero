# syntax=docker/dockerfile:1.6
#
# Release image: copies the goreleaser-built binary (frontend already embedded
# via go:embed, version already stamped) for the target architecture instead
# of compiling anything in-image. QEMU emulation then only runs this stage's
# trivial RUN steps (~seconds per arch) — not the whole Node+Go toolchain,
# which is what made multi-arch publishes take ~20 minutes.
#
# Build context: a staging directory laid out as <TARGETARCH>/budgero;
# scripts/release-selfhost.mjs prepares it under dist/docker.
# To build the image from source instead, use selfhost.Dockerfile.

FROM alpine:3.21

# apk upgrade ensures we get the latest security patches (e.g., busybox CVEs)
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates tzdata

RUN addgroup -g 1001 -S budgero && \
    adduser -S budgero -u 1001 -G budgero

WORKDIR /app

ARG TARGETARCH
COPY ${TARGETARCH}/budgero /app/budgero

RUN mkdir -p /data && chown -R budgero:budgero /data /app

ENV PORT=3001
ENV SELF_HOSTABLE=true
ENV DB_PATH=/data/budgero.db

USER budgero

EXPOSE 3001

VOLUME ["/data"]

ENTRYPOINT ["/app/budgero"]
CMD ["serve"]
