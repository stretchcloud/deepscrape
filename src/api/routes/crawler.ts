/**
 * @swagger
 * /api/crawl:
 *   post:
 *     summary: Initiate a new web crawl
 *     description: Starts a new web crawl with the specified parameters
 *     tags:
 *       - Crawler
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
 *                 description: URL to crawl
 *               includePaths:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of regex patterns for URLs to include
 *               excludePaths:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of regex patterns for URLs to exclude
 *               limit:
 *                 type: integer
 *                 description: Maximum number of URLs to crawl
 *                 default: 100
 *               maxDepth:
 *                 type: integer
 *                 description: Maximum depth to crawl
 *                 default: 5
 *               allowBackwardCrawling:
 *                 type: boolean
 *                 description: Allow crawling of URLs that are not descendants of the initial URL
 *                 default: false
 *               allowExternalContentLinks:
 *                 type: boolean
 *                 description: Allow crawling links that point to external content
 *                 default: false
 *               allowSubdomains:
 *                 type: boolean
 *                 description: Allow crawling subdomains of the initial domain
 *                 default: false
 *               ignoreRobotsTxt:
 *                 type: boolean
 *                 description: Ignore robots.txt rules
 *                 default: false
 *               regexOnFullURL:
 *                 type: boolean
 *                 description: Apply regex patterns to full URLs instead of just paths
 *                 default: false
 *               strategy:
 *                 type: string
 *                 enum: [bfs, dfs, best_first]
 *                 description: The crawling strategy to use (bfs = breadth-first, dfs = depth-first, best_first = prioritized)
 *                 default: bfs
 *               scrapeOptions:
 *                 type: object
 *                 description: Options for the scraper
 *               webhook:
 *                 type: string
 *                 description: URL to call when crawl is complete
 *           example:
 *             url: https://example.com
 *             includePaths: [".*"]
 *             excludePaths: []
 *             limit: 100
 *             maxDepth: 5
 *             allowBackwardCrawling: false
 *             allowExternalContentLinks: false
 *             allowSubdomains: false
 *             ignoreRobotsTxt: false
 *             regexOnFullURL: false
 *             strategy: bfs
 *             scrapeOptions:
 *               extractorFormat: markdown
 *               waitForTimeout: 5000
 *     responses:
 *       200:
 *         description: Crawl initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: string
 *                   description: The crawl ID
 *                 url:
 *                   type: string
 *                   description: The URL being crawled
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 *     security:
 *       - ApiKeyAuth: []
 */ 