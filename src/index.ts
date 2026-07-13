import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import scraperRoutes from './api/routes/scraper';
import crawlerRoutes from './api/routes/crawler.routes';
import batchScrapeRoutes from './api/routes/batch-scrape.routes';
import mapRoutes from './api/routes/map.routes';
import searchRoutes from './api/routes/search.routes';
import usageRoutes from './api/routes/usage.routes';
import { extractRouter, llmstxtRouter } from './api/routes/task.routes';
import parseRoutes from './api/routes/parse.routes';
import sessionRoutes from './api/routes/session.routes';
import agentRoutes from './api/routes/agent.routes';
import proxiesRoutes from './api/routes/proxies.routes';
import extractAutoRoutes from './api/routes/extract-auto.routes';
import { discoverApisRouter, readerRouter, crawlEstimateRouter } from './api/routes/phase2-tools.routes';
import { initTaskQueue, initTaskWorker, closeTaskQueue } from './services/task.service';
import { logger } from './utils/logger';
import { initQueue, initializeWorker, closeQueue } from './services/queue.service';
import { assertAuthConfigured } from './api/middleware/auth.middleware';
import { globalLimiter } from './api/middleware/rate-limit.middleware';
import { dailyQuota } from './api/middleware/quota.middleware';
import { metricsMiddleware, renderMetrics } from './services/metrics.service';
import { redisClient } from './services/redis.service';
import { startMaintenance, stopMaintenance } from './services/maintenance.service';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Access logging. Only write a file when LOG_TO_FILE isn't disabled and the
// filesystem is writable; otherwise log HTTP requests to stdout so the service
// runs on read-only/ephemeral platforms without crashing.
const logToFile = process.env.LOG_TO_FILE !== 'false';
let accessLogStream: NodeJS.WritableStream = process.stdout;
if (logToFile) {
  try {
    const logsDir = process.env.LOG_DIRECTORY
      ? path.resolve(process.env.LOG_DIRECTORY)
      : path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const stream = fs.createWriteStream(path.join(logsDir, 'access.log'), { flags: 'a' });
    // A write error (e.g. disk full) must not crash the process.
    stream.on('error', (err) => logger.error(`Access log stream error: ${err.message}`));
    accessLogStream = stream;
  } catch (err) {
    logger.warn(`Access log file disabled (${(err as Error).message}); logging to stdout`);
  }
}

// Configuration
const PORT = process.env.PORT ?? 3000;

// Middleware
app.use(helmet()); // Security headers

// CORS configuration
// TODO: In production, restrict CORS to specific origins for security
const isDevelopment = process.env.NODE_ENV !== 'production';
const corsOpenMode = process.env.CORS_OPEN_MODE === 'true'; // New flag for open CORS

// Function to determine CORS origin based on environment
function getCorsOrigin() {
  // If CORS_OPEN_MODE is explicitly set to true, allow all origins
  if (corsOpenMode) {
    logger.info('CORS running in OPEN mode - allowing all origins');
    return true;
  }
  
  if (isDevelopment) {
    // Allow all origins in development
    logger.info('CORS running in development mode - allowing all origins');
    return true;
  } else {
    // In production, use allowed origins from environment or block all
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : false;
    
    logger.info('CORS running in production mode', { 
      allowedOrigins: allowedOrigins ?? 'none' 
    });
    
    return allowedOrigins;
  }
}

const corsOptions: cors.CorsOptions = {
  origin: getCorsOrigin(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
// Request bodies are only URLs + options; a small limit prevents memory-exhaustion DoS.
const BODY_LIMIT = process.env.MAX_BODY_SIZE ?? '1mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(morgan('combined', { stream: accessLogStream })); // HTTP request logging

// Trust the first proxy hop (nginx) so req.ip reflects the real client for rate limiting.
app.set('trust proxy', 1);

// Record request metrics for every route.
app.use(metricsMiddleware);

// Global rate limit + per-key daily quota across all API traffic.
app.use('/api', globalLimiter);
app.use('/api', dailyQuota);

// API Routes
app.use('/api', scraperRoutes);
// Mount the crawl cost estimator before the crawl router so /estimate isn't shadowed by /:jobId.
app.use('/api/crawl/estimate', crawlEstimateRouter);
app.use('/api/crawl', crawlerRoutes);
app.use('/api/batch', batchScrapeRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/extract', extractRouter);
app.use('/api/llmstxt', llmstxtRouter);
app.use('/api/parse', parseRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/proxies', proxiesRoutes);
app.use('/api/extract-auto', extractAutoRoutes);
app.use('/api/discover-apis', discoverApisRouter);
app.use('/api/reader', readerRouter);

// Liveness probe — is the process up? (used by container/orchestrator healthchecks)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'Service is running' });
});

// Readiness probe — can the service actually do work? Checks Redis connectivity.
// Returns 503 when a dependency is down so load balancers stop routing traffic.
app.get('/health/ready', async (req, res) => {
  try {
    await redisClient.ping();
    res.status(200).json({ status: 'READY', redis: 'up' });
  } catch (err) {
    res.status(503).json({ status: 'NOT_READY', redis: 'down' });
  }
});

// Prometheus metrics (unauthenticated by convention; restrict at the edge/network).
app.get('/metrics', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(renderMetrics());
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Process role: 'web' (serve API + enqueue), 'worker' (process jobs only), or
// 'all' (both, default). Lets workers scale independently of the web tier.
// Safe now that the boot-time queue wipe is gone and job ids are deterministic.
const ROLE = (process.env.ROLE ?? 'all').toLowerCase();
const runWorker = ROLE === 'worker' || ROLE === 'all';

// Initialize the crawl queue and worker (resilient: logs on failure, retries).
async function initializeCrawlQueue(): Promise<void> {
  try {
    await initQueue();
    await initTaskQueue();
    if (runWorker) {
      initializeWorker();
      initTaskWorker();
      logger.info('Crawl + task queues + workers initialized (role: worker enabled)');
    } else {
      logger.info('Crawl + task queues initialized (role: web — enqueue only, no worker)');
    }
  } catch (error) {
    logger.error(`Failed to initialize crawl queue (will retry in 10s): ${error}`);
    setTimeout(() => { void initializeCrawlQueue(); }, 10_000);
  }
}

// Fail fast on invalid auth configuration (throws in production when unsafe).
try {
  assertAuthConfigured();
} catch (err) {
  logger.error(`Startup blocked: ${(err as Error).message}`);
  process.exit(1);
}

// Start server (bind reference so we can close it gracefully).
const server = app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
  await initializeCrawlQueue();
  startMaintenance();
});
// Give slow scrape/crawl requests time to complete behind a proxy.
server.headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS ?? 120_000);
server.requestTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS ?? 300_000);

// Graceful shutdown — registered unconditionally so it works even if queue init failed.
let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal} — shutting down gracefully...`);

  // Hard deadline: never let a hung dependency block shutdown forever.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000));
  forceExit.unref();

  // 1. Stop accepting new connections and stop background maintenance.
  stopMaintenance();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // 2. Stop the workers (waits for active jobs), then the queues.
  try {
    await closeQueue();
    await closeTaskQueue();
    logger.info('Queue services shut down');
  } catch (error) {
    logger.error('Error shutting down queue services:', error);
  }

  // 3. Tear down interactive sessions, then the browser pool.
  try {
    const { sessionManager } = await import('./services/session-manager.service');
    await sessionManager.shutdown();
    logger.info('Session manager shut down');
  } catch (error) {
    logger.error('Error shutting down session manager:', error);
  }
  try {
    const { BrowserPoolService } = await import('./services/browser-pool.service');
    await BrowserPoolService.getInstance().shutdown();
    logger.info('Browser pool shut down');
  } catch (error) {
    logger.error('Error shutting down browser pool:', error);
  }

  // 4. Close Redis.
  try {
    await redisClient.quit();
  } catch { /* ignore */ }

  clearTimeout(forceExit);
  process.exit(exitCode);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

// Handle uncaught exceptions — attempt browser/queue cleanup before exiting so
// we don't orphan Chromium processes, but never hang (shutdown has a hard timer).
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
  void shutdown('uncaughtException', 1);
});
