# ---- Build stage ----
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install all deps (incl. dev) for the TypeScript build. --ignore-scripts avoids
# running arbitrary package postinstall scripts.
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Production stage ----
# Official Playwright image: matches the installed playwright version and ships
# Chromium + all system libraries, so we don't hand-maintain an apt list or run a
# separate browser install. PLAYWRIGHT_BROWSERS_PATH=/ms-playwright is preset.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy AS production

# tini as PID 1 to reap zombie Chromium helper processes.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Built application.
COPY --from=builder /app/dist ./dist

# Writable runtime directories, owned by the non-root pwuser that ships with the
# Playwright image (uid 1000).
RUN mkdir -p /app/cache /app/logs /app/crawl-output /app/batch-output \
    && chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 3000

# Liveness check hits the process; readiness (Redis) is a separate endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

# tini reaps zombies; then start the app.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
