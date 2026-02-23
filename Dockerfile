# ── Werewolf Discord Bot ─────────────────────────────────────────────
# Multi-stage build for minimal image size
# ─────────────────────────────────────────────────────────────────────

# Stage 1: Build (install deps + native modules)
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ 

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Stage 2: Runtime
FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY index.js ./
COPY commands/ ./commands/
COPY game/ ./game/
COPY utils/ ./utils/
COPY database/ ./database/
COPY locales/ ./locales/
COPY monitoring/ ./monitoring/
COPY scripts/ ./scripts/
COPY audio/ ./audio/
COPY img/ ./img/

# Create data and logs directories (for SQLite + backups)
RUN mkdir -p /app/data /app/data/backups /app/logs

# Volumes for persistence
VOLUME ["/app/data", "/app/logs"]

# Environment
ENV NODE_ENV=production
ENV LOG_LEVEL=INFO

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node scripts/health-check.js || exit 1

# Run as non-root
RUN addgroup -S werewolf && adduser -S werewolf -G werewolf
RUN chown -R werewolf:werewolf /app
USER werewolf

CMD ["node", "index.js"]
