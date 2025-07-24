# Multi-stage build for smaller image
FROM node:18-bullseye AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
# Using --ignore-scripts for security during dependency installation
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-bullseye AS production

# Install system dependencies and Chromium
# Using --no-install-recommends to avoid installing unnecessary packages
RUN apt-get update && apt-get install -y --no-install-recommends \
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
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home deepscrape

# Copy package files and install production dependencies
COPY package*.json ./
# Using --ignore-scripts for security during dependency installation
RUN npm ci --only=production --ignore-scripts && \
    npx playwright install-deps chromium

# Copy built application from builder stage
COPY --from=builder --chown=deepscrape:nodejs /app/dist ./dist

# Copy health check script with read-only permissions
COPY --chown=deepscrape:nodejs --chmod=555 healthcheck.sh /app/healthcheck.sh

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
    CMD ["/app/healthcheck.sh"]

# Start the application
CMD ["node", "dist/index.js"]