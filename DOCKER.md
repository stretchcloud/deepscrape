# DeepScrape Docker Documentation

This guide provides comprehensive instructions for running DeepScrape using Docker, including both pre-built images and building from source.

## Prerequisites

- **Docker** and **Docker Compose** installed on your system
- **OpenAI API key** (required for LLM-powered extraction)
- **Git** (for building from source)

## Quick Start with Docker Compose (Recommended)

The easiest way to run DeepScrape is using Docker Compose, which automatically sets up both the application and Redis.

### 1. Clone the Repository

```bash
git clone https://github.com/stretchcloud/deepscrape.git
cd deepscrape
```

### 2. Create Environment File

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Extraction Settings
MAX_EXTRACTION_TOKENS=15000
LLM_TEMPERATURE=0.2

# Scraper Configuration
MAX_TIMEOUT=60000
BLOCK_RESOURCES=true
BLOCK_ADS=true
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36

# API Security
API_KEY=your-secret-api-key-change-this

# OpenAI Configuration (REQUIRED)
OPENAI_API_KEY=your-openai-api-key-here
OPENAI_MODEL=gpt-4o

# Redis Configuration (Docker service names)
REDIS_HOST=redis
REDIS_PORT=6379

# Cache Configuration
CACHE_ENABLED=true
CACHE_TTL=3600
CACHE_DIRECTORY=/app/cache

# Logging Configuration
LOG_DIRECTORY=/app/logs
```

### 3. Build and Start Services

```bash
# Build and start all services
docker-compose up -d

# Check logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 4. Verify Installation

```bash
# Test health endpoint
curl http://localhost:3000/health

# Test scraping
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-api-key-change-this" \
  -d '{
    "url": "https://cloud.google.com/vertex-ai/docs/start/introduction-unified-platform",
    "options": {
      "extractorFormat": "markdown"
    }
  }' | jq -r '.content' > vertex-ai-intro.md
```

---

## Docker Compose Configuration

The included `docker-compose.yml` provides a complete setup with:

- **DeepScrape Application**: Main scraping service with Playwright browser automation
- **Redis**: For job queuing and caching
- **Health Checks**: Automatic service monitoring
- **Volume Mounts**: Persistent cache and logs
- **Network Isolation**: Secure inter-service communication

### Services Overview

```yaml
version: '3.8'

services:
  # Redis service for job queue and caching
  redis:
    image: redis:7-alpine
    container_name: deepscrape-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  # Main DeepScrape application
  deepscrape:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: deepscrape-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - LOG_DIRECTORY=/app/logs
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    env_file:
      - .env
    volumes:
      - ./cache:/app/cache
      - ./logs:/app/logs
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

---

## Building from Source

### Dockerfile Overview

The application uses a multi-stage Ubuntu-based Dockerfile optimized for Playwright:

```dockerfile
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

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Create app directory and non-root user
WORKDIR /app
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home deepscrape

# Install production dependencies and Playwright
COPY package*.json ./
RUN npm ci --only=production
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

# Copy built application
COPY --from=builder --chown=deepscrape:nodejs /app/dist ./dist

# Set up directories and permissions
RUN mkdir -p /app/cache /app/logs && \
    touch /app/logs/access.log /app/logs/combined.log /app/logs/error.log && \
    chown -R deepscrape:nodejs /app

# Switch to non-root user
USER deepscrape

# Expose port and add health check
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
```

### Manual Build Steps

```bash
# Clone repository
git clone https://github.com/stretchcloud/deepscrape.git
cd deepscrape

# Build Docker image
docker build -t deepscrape:latest .

# Run with custom image
docker run -d \
  --name deepscrape \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/logs:/app/logs \
  deepscrape:latest
```

---

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| **Core Configuration** |
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment mode | `production` | No |
| `LOG_LEVEL` | Logging level | `info` | No |
| `API_KEY` | API authentication key | None | **Yes** |
| **OpenAI Configuration** |
| `OPENAI_API_KEY` | OpenAI API key | None | **Yes** |
| `OPENAI_MODEL` | Model to use | `gpt-4o` | No |
| `OPENAI_ORGANIZATION` | Organization ID | None | No |
| **Redis Configuration** |
| `REDIS_HOST` | Redis hostname | `localhost` | No |
| `REDIS_PORT` | Redis port | `6379` | No |
| **Cache Configuration** |
| `CACHE_ENABLED` | Enable caching | `true` | No |
| `CACHE_TTL` | Cache TTL (seconds) | `3600` | No |
| `CACHE_DIRECTORY` | Cache directory | `/app/cache` | No |

---

### Service Management

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f deepscrape
docker-compose logs -f redis
```

### Maintenance

```bash
# Rebuild application (after code changes)
docker-compose build --no-cache deepscrape
docker-compose up -d

# Clean up unused resources
docker system prune -f

# Update images
docker-compose pull
docker-compose up -d
```

### Debugging

```bash
# Execute commands in running container
docker-compose exec deepscrape bash

# Check container resource usage
docker stats

# Inspect container configuration
docker-compose exec deepscrape env
```

---

## API Testing Examples

### Basic Scraping

```bash
# Simple HTML extraction
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://example.com",
    "options": {
      "extractorFormat": "html"
    }
  }'

# Markdown conversion
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://news.ycombinator.com",
    "options": {
      "extractorFormat": "markdown"
    }
  }'
```

### LLM-Powered Extraction

```bash
# Structured data extraction
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://example-ecommerce.com/product/123",
    "options": {
      "extractorFormat": "llm",
      "extractorOptions": {
        "schema": {
          "type": "object",
          "properties": {
            "title": {"type": "string"},
            "price": {"type": "number"},
            "description": {"type": "string"},
            "availability": {"type": "string"}
          }
        }
      }
    }
  }'
```

---

## Troubleshooting

### Common Issues

**1. Container fails to start**
```bash
# Check logs for errors
docker-compose logs deepscrape

# Common causes:
# - Missing .env file
# - Invalid OpenAI API key
# - Port 3000 already in use
```

**2. Playwright browser issues**
```bash
# The application includes HTTP fallback for browser failures
# Check logs for "falling back to HTTP scraper" messages
docker-compose logs deepscrape | grep -i "fallback"
```

**3. Redis connection errors**
```bash
# Verify Redis is running
docker-compose ps redis

# Check Redis logs
docker-compose logs redis

# Test Redis connectivity
docker-compose exec redis redis-cli ping
```

**4. Permission errors**
```bash
# Fix volume permissions
sudo chown -R $USER:$USER ./cache ./logs

# Or run with proper permissions
docker-compose down
sudo rm -rf ./cache ./logs
docker-compose up -d
```

### Performance Optimization

**Memory Usage**
```yaml
# Add to docker-compose.yml under deepscrape service
deploy:
  resources:
    limits:
      memory: 2G
    reservations:
      memory: 1G
```

**Browser Optimization**
```env
# Add to .env for better browser performance
PLAYWRIGHT_BROWSER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage
```

---

## Production Deployment

### Security Considerations

1. **Use strong API keys**
2. **Limit network exposure** (use reverse proxy)
3. **Regular updates** of base images
4. **Monitor resource usage**
5. **Implement rate limiting**

### Scaling

```yaml
# docker-compose.yml for multiple instances
version: '3.8'
services:
  deepscrape:
    # ... existing config
    deploy:
      replicas: 3
    
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - deepscrape
```

### Monitoring

```bash
# Add health check monitoring
curl -f http://localhost:3000/health || exit 1

# Monitor logs
docker-compose logs -f --tail=100

# Resource monitoring
docker stats deepscrape-app deepscrape-redis
```

This documentation provides a complete guide for running DeepScrape in Docker with proper configuration, troubleshooting, and production considerations.
