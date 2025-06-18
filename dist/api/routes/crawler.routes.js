"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crawler_controller_1 = require("../controllers/crawler.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Apply API key authentication to all routes
router.use(auth_middleware_1.apiKeyAuth);
/**
 * @route   POST /api/crawl
 * @desc    Initiate a new web crawl
 * @access  Private (API Key required)
 */
router.post('/', crawler_controller_1.crawl);
/**
 * @route   GET /api/crawl/:jobId
 * @desc    Get status of a crawl job
 * @access  Private (API Key required)
 */
router.get('/:jobId', crawler_controller_1.getCrawlStatus);
/**
 * @route   DELETE /api/crawl/:jobId
 * @desc    Cancel a running crawl job
 * @access  Private (API Key required)
 */
router.delete('/:jobId', crawler_controller_1.cancelCrawlJob);
exports.default = router;
