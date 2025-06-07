# Multi-stage build for smaller image
FROM node:18-bullseye AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-bullseye AS production

# Install system dependencies and Chromium
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home deepscrape

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Install Playwright system dependencies as root
RUN npx playwright install-deps chromium

# Copy built application from builder stage
COPY --from=builder --chown=deepscrape:nodejs /app/dist ./dist

# Create directories and set proper permissions
RUN mkdir -p /app/cache /app/logs /home/deepscrape/.cache && \
    touch /app/logs/access.log /app/logs/combined.log /app/logs/error.log && \
    chown -R deepscrape:nodejs /app /home/deepscrape/.cache

# Switch to non-root user
USER deepscrape

# Install Playwright browsers as the deepscrape user
RUN npx playwright install chromium

# Set Playwright environment variables
ENV PLAYWRIGHT_BROWSERS_PATH=/home/deepscrape/.cache/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]