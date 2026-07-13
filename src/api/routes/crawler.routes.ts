import { Router, RequestHandler } from 'express';
import {
  crawl,
  getCrawlStatus,
  cancelCrawlJob,
  streamCrawl,
  downloadCrawlZip,
  downloadCrawlJson,
  getCrawlErrorsHandler,
  listActiveCrawls
} from '../controllers/crawler.controller';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateCrawlRequest } from '../middleware/crawl-validation.middleware';
import { crawlLimiter, statusLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// Apply API key authentication to all routes
router.use(apiKeyAuth);

/**
 * @route   POST /api/crawl
 * @desc    Initiate a new web crawl
 * @access  Private (API Key required)
 */
router.post('/', crawlLimiter, validateCrawlRequest, crawl as unknown as RequestHandler);

/**
 * @route   GET /api/crawl/active
 * @desc    List currently-active crawls (must precede /:jobId)
 * @access  Private (API Key required)
 */
router.get('/active', statusLimiter, listActiveCrawls);

/**
 * @route   GET /api/crawl/:jobId
 * @desc    Get status of a crawl job
 * @access  Private (API Key required)
 */
router.get('/:jobId', statusLimiter, getCrawlStatus as unknown as RequestHandler);

/**
 * @route   GET /api/crawl/:jobId/errors
 * @desc    List per-page failures (failed URLs + error) for a crawl
 * @access  Private (API Key required)
 */
router.get('/:jobId/errors', statusLimiter, getCrawlErrorsHandler as unknown as RequestHandler);

/**
 * @route   GET /api/crawl/:jobId/stream
 * @desc    Stream crawl pages as Server-Sent Events as they complete
 * @access  Private (API Key required)
 */
router.get('/:jobId/stream', streamCrawl as unknown as RequestHandler);

/**
 * @route   GET /api/crawl/:jobId/download/zip
 * @desc    Download all completed pages as a ZIP (?format=markdown|json)
 * @access  Private (API Key required)
 */
router.get('/:jobId/download/zip', statusLimiter, downloadCrawlZip as unknown as RequestHandler);

/**
 * @route   GET /api/crawl/:jobId/download/json
 * @desc    Download all completed pages as a consolidated JSON array
 * @access  Private (API Key required)
 */
router.get('/:jobId/download/json', statusLimiter, downloadCrawlJson as unknown as RequestHandler);

/**
 * @route   DELETE /api/crawl/:jobId
 * @desc    Cancel a running crawl job
 * @access  Private (API Key required)
 */
router.delete('/:jobId', cancelCrawlJob);

export default router; 