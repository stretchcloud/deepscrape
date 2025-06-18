import { Router } from 'express';
import { crawl, getCrawlStatus, cancelCrawlJob } from '../controllers/crawler.controller';
import { apiKeyAuth } from '../middleware/auth.middleware';

const router = Router();

// Apply API key authentication to all routes
router.use(apiKeyAuth);

/**
 * @route   POST /api/crawl
 * @desc    Initiate a new web crawl
 * @access  Private (API Key required)
 */
router.post('/', crawl);

/**
 * @route   GET /api/crawl/:jobId
 * @desc    Get status of a crawl job
 * @access  Private (API Key required)
 */
router.get('/:jobId', getCrawlStatus);

/**
 * @route   DELETE /api/crawl/:jobId
 * @desc    Cancel a running crawl job
 * @access  Private (API Key required)
 */
router.delete('/:jobId', cancelCrawlJob);

export default router; 