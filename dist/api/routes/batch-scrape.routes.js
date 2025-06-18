"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const validation_1 = require("../middleware/validation");
const auth_middleware_1 = require("../middleware/auth.middleware");
const batch_scrape_controller_1 = require("../controllers/batch-scrape.controller");
const router = (0, express_1.Router)();
/**
 * Validation rules for batch scrape request
 */
const batchScrapeValidation = [
    (0, express_validator_1.body)('urls')
        .isArray({ min: 1, max: 100 })
        .withMessage('URLs must be an array with 1-100 items'),
    (0, express_validator_1.body)('urls.*')
        .isURL()
        .withMessage('Each URL must be valid'),
    (0, express_validator_1.body)('concurrency')
        .optional()
        .isInt({ min: 1, max: 10 })
        .withMessage('Concurrency must be between 1 and 10'),
    (0, express_validator_1.body)('webhook')
        .optional()
        .isURL()
        .withMessage('Webhook must be a valid URL'),
    (0, express_validator_1.body)('timeout')
        .optional()
        .isInt({ min: 10000 })
        .withMessage('Timeout must be at least 10 seconds (10000ms)'),
    (0, express_validator_1.body)('failFast')
        .optional()
        .isBoolean()
        .withMessage('failFast must be a boolean'),
    (0, express_validator_1.body)('maxRetries')
        .optional()
        .isInt({ min: 0, max: 10 })
        .withMessage('maxRetries must be between 0 and 10'),
    (0, express_validator_1.body)('options')
        .optional()
        .isObject()
        .withMessage('Options must be an object'),
    (0, express_validator_1.body)('options.timeout')
        .optional()
        .isInt({ min: 1000, max: 300000 })
        .withMessage('Options timeout must be between 1000ms and 300000ms'),
    (0, express_validator_1.body)('options.userAgent')
        .optional()
        .isString()
        .isLength({ max: 500 })
        .withMessage('User agent must be a string with max 500 characters'),
    (0, express_validator_1.body)('options.waitForTimeout')
        .optional()
        .isInt({ min: 0, max: 60000 })
        .withMessage('waitForTimeout must be between 0 and 60000ms')
];
/**
 * Validation rules for batch ID parameter
 */
const batchIdValidation = [
    (0, express_validator_1.param)('batchId')
        .isUUID()
        .withMessage('Batch ID must be a valid UUID')
];
/**
 * Validation rules for cleanup query
 */
const cleanupValidation = [
    (0, express_validator_1.query)('days')
        .optional()
        .isInt({ min: 1, max: 365 })
        .withMessage('Days must be between 1 and 365')
];
/**
 * POST /api/batch/scrape
 * Initiate a new batch scraping operation
 */
router.post('/scrape', auth_middleware_1.apiKeyAuth, batchScrapeValidation, validation_1.handleValidationErrors, batch_scrape_controller_1.batchScrapeController.initiateBatch.bind(batch_scrape_controller_1.batchScrapeController));
/**
 * GET /api/batch/scrape/:batchId/status
 * Get batch scraping status and results
 */
router.get('/scrape/:batchId/status', auth_middleware_1.apiKeyAuth, batchIdValidation, validation_1.handleValidationErrors, batch_scrape_controller_1.batchScrapeController.getBatchStatus.bind(batch_scrape_controller_1.batchScrapeController));
/**
 * DELETE /api/batch/scrape/:batchId
 * Cancel a batch scraping operation
 */
router.delete('/scrape/:batchId', auth_middleware_1.apiKeyAuth, batchIdValidation, validation_1.handleValidationErrors, batch_scrape_controller_1.batchScrapeController.cancelBatch.bind(batch_scrape_controller_1.batchScrapeController));
/**
 * GET /api/batch/scrape/:batchId/download/zip
 * Download all results as a ZIP file
 */
router.get('/scrape/:batchId/download/zip', auth_middleware_1.apiKeyAuth, [
    ...batchIdValidation,
    (0, express_validator_1.query)('format')
        .optional()
        .isIn(['json', 'markdown', 'html', 'text'])
        .withMessage('Format must be one of: json, markdown, html, text')
], validation_1.handleValidationErrors, batch_scrape_controller_1.batchScrapeController.downloadBatchZip.bind(batch_scrape_controller_1.batchScrapeController));
/**
 * GET /api/batch/scrape/:batchId/download/json
 * Download all results in a single JSON file
 */
router.get('/scrape/:batchId/download/json', auth_middleware_1.apiKeyAuth, batchIdValidation, validation_1.handleValidationErrors, batch_scrape_controller_1.batchScrapeController.downloadBatchJson.bind(batch_scrape_controller_1.batchScrapeController));
/**
 * GET /api/batch/scrape/:batchId/download/:jobId
 * Download individual result by job ID
 */
router.get('/scrape/:batchId/download/:jobId', auth_middleware_1.apiKeyAuth, [
    ...batchIdValidation,
    (0, express_validator_1.param)('jobId')
        .notEmpty()
        .withMessage('Job ID is required'),
    (0, express_validator_1.query)('format')
        .optional()
        .isIn(['json', 'markdown', 'html', 'text'])
        .withMessage('Format must be one of: json, markdown, html, text')
], validation_1.handleValidationErrors, batch_scrape_controller_1.batchScrapeController.downloadResult.bind(batch_scrape_controller_1.batchScrapeController));
/**
 * POST /api/batch/cleanup
 * Clean up old batch data
 */
router.post('/cleanup', auth_middleware_1.apiKeyAuth, cleanupValidation, validation_1.handleValidationErrors, batch_scrape_controller_1.batchScrapeController.cleanup.bind(batch_scrape_controller_1.batchScrapeController));
exports.default = router;
