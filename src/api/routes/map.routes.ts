import { Router } from 'express';
import { MapController } from '../controllers/map.controller';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter } from '../middleware/rate-limit.middleware';
import { mapRequestSchema, mapClearCacheSchema } from '../schemas';

// Validation schema for map request
// Validation schema for cache clear request
const router = Router();
const mapController = new MapController();

/**
 * @swagger
 * /api/map:
 *   post:
 *     summary: Discover URLs from a website
 *     description: |
 *       URL discovery endpoint that uses multiple parallel methods:
 *       - Sitemap parsing (XML sitemaps, sitemap indexes, robots.txt)
 *       - Search engine discovery (site: queries)
 *       - Browser-based crawling
 *       - Common path discovery
 *       - Robots.txt sitemap references
 *     tags:
 *       - URL Discovery
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: Target website URL
 *                 example: "https://docs.example.com"
 *               maxUrls:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 30000
 *                 default: 5000
 *                 description: Maximum number of URLs to discover
 *               includeSubdomains:
 *                 type: boolean
 *                 default: true
 *                 description: Include subdomains in discovery
 *               searchQuery:
 *                 type: string
 *                 description: Optional search query for targeted discovery
 *                 example: "api documentation"
 *               skipSitemaps:
 *                 type: boolean
 *                 default: false
 *                 description: Skip sitemap-based discovery
 *               sitemapsOnly:
 *                 type: boolean
 *                 default: false
 *                 description: Use only sitemap-based discovery
 *               useUrlIndex:
 *                 type: boolean
 *                 default: true
 *                 description: Use pre-built URL index (future feature)
 *               timeoutMs:
 *                 type: integer
 *                 minimum: 1000
 *                 maximum: 300000
 *                 default: 30000
 *                 description: Discovery timeout in milliseconds
 *               includePatterns:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Include only URLs containing these path segments
 *                 example: ["docs", "api", "guides"]
 *               excludePatterns:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Exclude URLs containing these patterns
 *                 example: ["admin", "login", "private"]
 *     responses:
 *       200:
 *         description: URLs discovered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     links:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: uri
 *                     total:
 *                       type: integer
 *                     discoveryMethods:
 *                       type: object
 *                       properties:
 *                         sitemap:
 *                           type: integer
 *                         search:
 *                           type: integer
 *                         crawling:
 *                           type: integer
 *                         commonPaths:
 *                           type: integer
 *                         robotsSitemaps:
 *                           type: integer
 *                     timeTaken:
 *                       type: number
 *                     fromCache:
 *                       type: boolean
 *                     searchQuery:
 *                       type: string
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                     includeSubdomains:
 *                       type: boolean
 *                     maxUrls:
 *                       type: integer
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized - invalid API key
 *       500:
 *         description: Internal server error
 */
router.post(
  '/',
  expensiveLimiter,
  apiKeyAuth,
  validateRequest(mapRequestSchema),
  mapController.discoverUrls.bind(mapController)
);

/**
 * @swagger
 * /api/map/cache/stats:
 *   get:
 *     summary: Get discovery cache statistics
 *     description: Retrieve information about the URL discovery cache
 *     tags:
 *       - URL Discovery
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalKeys:
 *                       type: integer
 *                       description: Number of cached discovery results
 *                     totalSize:
 *                       type: string
 *                       description: Total cache size in MB
 *       401:
 *         description: Unauthorized - invalid API key
 *       500:
 *         description: Internal server error
 */
router.get(
  '/cache/stats',
  apiKeyAuth,
  mapController.getCacheStats.bind(mapController)
);

/**
 * @swagger
 * /api/map/cache/clear:
 *   post:
 *     summary: Clear discovery cache for a URL
 *     description: Remove cached discovery results for a specific URL
 *     tags:
 *       - URL Discovery
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: URL to clear cache for
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *       400:
 *         description: Invalid URL
 *       401:
 *         description: Unauthorized - invalid API key
 *       500:
 *         description: Internal server error
 */
router.post(
  '/cache/clear',
  apiKeyAuth,
  validateRequest(mapClearCacheSchema),
  mapController.clearCache.bind(mapController)
);

/**
 * @swagger
 * /api/map/health:
 *   get:
 *     summary: Health check for map service
 *     description: Check the health status of the URL discovery service
 *     tags:
 *       - URL Discovery
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                   enum: [healthy, unhealthy]
 *                 services:
 *                   type: object
 *                   properties:
 *                     cache:
 *                       type: string
 *                     discovery:
 *                       type: string
 *                 cacheStats:
 *                   type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       503:
 *         description: Service is unhealthy
 */
router.get(
  '/health',
  apiKeyAuth,
  mapController.healthCheck.bind(mapController)
);

export default router;