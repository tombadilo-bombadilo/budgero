# Multi-stage Dockerfile for Next.js (standalone)

FROM oven/bun:1-alpine AS deps
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS builder
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# PostHog (public client-side key, baked into the Next.js bundle; events via reverse proxy).
# Provided by the build environment: docker build --build-arg NEXT_PUBLIC_POSTHOG_KEY=...
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:1-alpine AS runner
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Defaults for Next.js
EXPOSE 3000
ENV PORT=3000

CMD ["bun", "server.js"]
