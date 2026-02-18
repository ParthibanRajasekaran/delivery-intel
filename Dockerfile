# ============================================================================
# Delivery Intel — Docker Image
# ============================================================================
# Multi-stage build: builds both the CLI and the Next.js dashboard
#
# Usage:
#   docker build -t delivery-intel .
#
#   # Run CLI:
#   docker run --rm -e GITHUB_TOKEN=ghp_xxx delivery-intel cli vercel/next.js
#
#   # Run Dashboard:
#   docker run --rm -p 3000:3000 -e GITHUB_TOKEN=ghp_xxx delivery-intel
# ============================================================================

FROM node:20-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 2: Build
# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build CLI
RUN npm run build:cli

# Build Next.js (standalone output for smaller image)
RUN GITHUB_TOKEN=build-placeholder npm run build

# ---------------------------------------------------------------------------
# Stage 3: Production image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy Next.js build
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

# Copy CLI build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin

# Entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["dashboard"]
