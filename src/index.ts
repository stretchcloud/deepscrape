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
import { logger } from './utils/logger';
import { initQueue, initializeWorker, closeQueue } from './services/queue.service';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Set up logging - ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'),
  { flags: 'a' }
);

// Configuration
const PORT = process.env.PORT ?? 3000;

// Middleware
app.use(helmet()); // Security headers

// CORS configuration
// TODO: In production, restrict CORS to specific origins for security
const isDevelopment = process.env.NODE_ENV !== 'production';

// Function to determine CORS origin based on environment
function getCorsOrigin() {
  if (isDevelopment) {
    // Allow all origins in development
    return true;
  } else {
    // In production, use allowed origins from environment or block all
    return process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : false;
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
app.use(express.json({ limit: '50mb' })); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded request bodies
app.use(morgan('combined', { stream: accessLogStream })); // HTTP request logging

// API Routes
app.use('/api', scraperRoutes);
app.use('/api/crawl', crawlerRoutes);
app.use('/api/batch', batchScrapeRoutes);
app.use('/api/map', mapRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'Service is running' });
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

// Initialize the crawl queue and worker
async function initializeCrawlQueue() {
  try {
    // Initialize queue
    await initQueue();
    
    // Start worker to process crawl jobs
    initializeWorker();
    
    logger.info('Crawl queue and worker initialized successfully');
    
    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down services...');
      
      try {
        // Import browser pool service for shutdown
        const { BrowserPoolService } = await import('./services/browser-pool.service');
        const browserPool = BrowserPoolService.getInstance();
        await browserPool.shutdown();
        logger.info('Browser pool shut down successfully');
      } catch (error) {
        logger.error('Error shutting down browser pool:', error);
      }
      
      try {
        await closeQueue();
        logger.info('Queue service shut down successfully');
      } catch (error) {
        logger.error('Error shutting down queue service:', error);
      }
      
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error(`Failed to initialize crawl queue: ${error}`);
  }
}

// Start server
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV ?? 'development'}`);;
  
  // Initialize crawl queue after server starts
  await initializeCrawlQueue();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  // Graceful shutdown
  process.exit(1);
}); 