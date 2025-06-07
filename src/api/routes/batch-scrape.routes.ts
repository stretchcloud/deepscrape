import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validateRequest } from '../middleware/validation';
import { batchScrapeController } from '../controllers/batch-scrape.controller';

const router = Router();

/**
 * Validation rules for batch scrape request
 */
const batchScrapeValidation = [
  body('urls')
    .isArray({ min: 1, max: 100 })
    .withMessage('URLs must be an array with 1-100 items'),
  body('urls.*')
    .isURL()
    .withMessage('Each URL must be valid'),
  body('concurrency')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Concurrency must be between 1 and 10'),
  body('webhook')
    .optional()
    .isURL()
    .withMessage('Webhook must be a valid URL'),
  body('timeout')
    .optional()
    .isInt({ min: 10000 })
    .withMessage('Timeout must be at least 10 seconds (10000ms)'),
  body('failFast')
    .optional()
    .isBoolean()
    .withMessage('failFast must be a boolean'),
  body('maxRetries')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('maxRetries must be between 0 and 10'),
  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object'),
  body('options.timeout')
    .optional()
    .isInt({ min: 1000, max: 300000 })
    .withMessage('Options timeout must be between 1000ms and 300000ms'),
  body('options.userAgent')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('User agent must be a string with max 500 characters'),
  body('options.waitForTimeout')
    .optional()
    .isInt({ min: 0, max: 60000 })
    .withMessage('waitForTimeout must be between 0 and 60000ms')
];

/**
 * Validation rules for batch ID parameter
 */
const batchIdValidation = [
  param('batchId')
    .isUUID()
    .withMessage('Batch ID must be a valid UUID')
];

/**
 * Validation rules for cleanup query
 */
const cleanupValidation = [
  query('days')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('Days must be between 1 and 365')
];

/**
 * POST /api/batch/scrape
 * Initiate a new batch scraping operation
 */
router.post(
  '/scrape',
  batchScrapeValidation,
  validateRequest,
  batchScrapeController.initiateBatch.bind(batchScrapeController)
);

/**
 * GET /api/batch/scrape/:batchId/status
 * Get batch scraping status and results
 */
router.get(
  '/scrape/:batchId/status',
  batchIdValidation,
  validateRequest,
  batchScrapeController.getBatchStatus.bind(batchScrapeController)
);

/**
 * DELETE /api/batch/scrape/:batchId
 * Cancel a batch scraping operation
 */
router.delete(
  '/scrape/:batchId',
  batchIdValidation,
  validateRequest,
  batchScrapeController.cancelBatch.bind(batchScrapeController)
);

/**
 * GET /api/batch/scrape/:batchId/download/:jobId
 * Download individual result by job ID
 */
router.get(
  '/scrape/:batchId/download/:jobId',
  [
    ...batchIdValidation,
    param('jobId')
      .notEmpty()
      .withMessage('Job ID is required'),
    query('format')
      .optional()
      .isIn(['json', 'markdown', 'html', 'text'])
      .withMessage('Format must be one of: json, markdown, html, text')
  ],
  validateRequest,
  batchScrapeController.downloadResult.bind(batchScrapeController)
);

/**
 * GET /api/batch/scrape/:batchId/download/zip
 * Download all results as a ZIP file
 */
router.get(
  '/scrape/:batchId/download/zip',
  [
    ...batchIdValidation,
    query('format')
      .optional()
      .isIn(['json', 'markdown', 'html', 'text'])
      .withMessage('Format must be one of: json, markdown, html, text')
  ],
  validateRequest,
  batchScrapeController.downloadBatchZip.bind(batchScrapeController)
);

/**
 * GET /api/batch/scrape/:batchId/download/json
 * Download all results in a single JSON file
 */
router.get(
  '/scrape/:batchId/download/json',
  batchIdValidation,
  validateRequest,
  batchScrapeController.downloadBatchJson.bind(batchScrapeController)
);

/**
 * POST /api/batch/cleanup
 * Clean up old batch data
 */
router.post(
  '/cleanup',
  cleanupValidation,
  validateRequest,
  batchScrapeController.cleanup.bind(batchScrapeController)
);

export default router;