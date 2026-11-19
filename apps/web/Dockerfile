# syntax=docker/dockerfile:1
#
# Production container for the Career Lattice Next.js app (apps/web).
# Multi-stage: install deps -> build (standalone) -> minimal runtime.
# Designed for Google Cloud Run (listens on $PORT, 0.0.0.0, non-root user).
#
# Build context = this directory (apps/web), which is a self-contained npm
# project (its own package.json + package-lock.json).
#
#   docker build -t career-lattice-web .
#   docker run --rm -p 8080:8080 --env-file .env.docker career-lattice-web
#
# Secrets (Supabase, Anthropic, admin password) are injected at RUNTIME via
# Cloud Run env / Secret Manager, NOT baked into the image. The build itself
# needs no secrets because every data-bound route is server-rendered on
# demand (nothing DB-backed is statically prerendered).

# ---- 1. deps: install node_modules from the lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
# libc6-compat helps the rare native dep run on alpine/musl.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# Use `npm install` (not `npm ci`) because the committed lockfile drifts from
# package.json on some platforms (optional native deps like @emnapi/* differ by
# OS/arch). This matches how the local + Vercel builds install and keeps the
# container build from failing on strict lockfile validation.
RUN npm install --no-audit --no-fund

# ---- 2. builder: compile the standalone server bundle ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined at build time. Pass any that the client
# bundle actually reads as build args; others stay runtime-only.
ARG NEXT_PUBLIC_SITE_URL=https://career-lattice-beta.vercel.app
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
RUN npm run build

# ---- 3. runner: ship only the standalone output ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run sends traffic to $PORT (default 8080); Next's standalone server
# honors PORT + HOSTNAME.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
# Run as an unprivileged user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# public assets (Rev images, icons) + the traced server + static chunks.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
