"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebCrawler = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = require("cheerio");
const url_1 = require("url");
const robots_parser_1 = __importDefault(require("robots-parser"));
const https_1 = __importDefault(require("https"));
const logger_1 = require("../utils/logger");
const crawler_1 = require("../types/crawler");
const playwright_service_1 = require("../services/playwright.service");
const url_normalization_service_1 = require("../services/url-normalization.service");
class WebCrawler {
    constructor({ jobId, initialUrl, baseUrl, includes, excludes, maxCrawledLinks = 10000, limit = 10000, maxCrawledDepth = 10, allowBackwardCrawling = false, allowExternalContentLinks = false, allowSubdomains = false, ignoreRobotsTxt = false, regexOnFullURL = false, strategy = crawler_1.CrawlStrategy.BFS, hooks = {}, maxDiscoveryDepth, currentDiscoveryDepth, useBrowser = false, deduplicateSimilarUrls = true, }) {
        this.visited = new Set();
        this.crawledUrls = new Map();
        this.lockedUrls = new Set();
        this.redirectMapping = new Map();
        this.deduplicateSimilarUrls = true;
        this.sitemapsHit = new Set();
        this.urlQueue = [];
        this.urlScores = new Map();
        this.playwrightService = null;
        this.useBrowser = false;
        this.urlNormalizationService = url_normalization_service_1.UrlNormalizationService;
        this.jobId = jobId;
        this.initialUrl = initialUrl;
        this.baseUrl = baseUrl ?? new url_1.URL(initialUrl).origin;
        this.includes = Array.isArray(includes) ? includes : [];
        this.excludes = Array.isArray(excludes) ? excludes : [];
        this.limit = limit;
        this.robotsTxtUrl = `${this.baseUrl}${this.baseUrl.endsWith("/") ? "" : "/"}robots.txt`;
        this.robots = (0, robots_parser_1.default)(this.robotsTxtUrl, "");
        this.maxCrawledLinks = maxCrawledLinks ?? limit;
        this.maxCrawledDepth = maxCrawledDepth ?? 10;
        this.allowBackwardCrawling = allowBackwardCrawling ?? false;
        this.allowExternalContentLinks = allowExternalContentLinks ?? false;
        this.allowSubdomains = allowSubdomains ?? false;
        this.ignoreRobotsTxt = ignoreRobotsTxt ?? false;
        this.regexOnFullURL = regexOnFullURL ?? false;
        this.logger = logger_1.logger;
        this.maxDiscoveryDepth = maxDiscoveryDepth;
        this.currentDiscoveryDepth = currentDiscoveryDepth ?? 0;
        this.strategy = strategy;
        this.hooks = hooks;
        this.useBrowser = useBrowser;
        this.deduplicateSimilarUrls = deduplicateSimilarUrls;
        // Initialize PlaywrightService if browser mode is enabled
        if (this.useBrowser) {
            this.playwrightService = new playwright_service_1.PlaywrightService();
            this.playwrightService.on('url-discovered', (data) => {
                logger_1.logger.info(`Discovered URL: ${data.url} (Total: ${data.totalDiscovered})`);
            });
            this.playwrightService.on('url-crawled', (data) => {
                logger_1.logger.info(`Crawled URL: ${data.url} (Total: ${data.totalCrawled})`);
            });
        }
    }
    /**
     * Check if link matches exclude patterns
     */
    isExcludedByPatterns(link, path) {
        if (this.excludes.length === 0 || this.excludes[0] === "") {
            return false;
        }
        const testPath = this.regexOnFullURL ? link : path;
        return this.excludes.some((excludePattern) => new RegExp(excludePattern).test(testPath));
    }
    /**
     * Check if link matches include patterns
     */
    isIncludedByPatterns(link, path) {
        if (this.includes.length === 0 || this.includes[0] === "") {
            return true;
        }
        const testPath = this.regexOnFullURL ? link : path;
        return this.includes.some((includePattern) => new RegExp(includePattern).test(testPath));
    }
    /**
     * Check backward crawling restrictions
     */
    isBackwardCrawlingAllowed(normalizedLink) {
        if (this.allowBackwardCrawling) {
            return true;
        }
        try {
            const normalizedInitialUrl = new url_1.URL(this.initialUrl);
            const normalizedLinkUrl = new url_1.URL(normalizedLink);
            return normalizedLinkUrl.pathname.startsWith(normalizedInitialUrl.pathname);
        }
        catch (_) {
            return false;
        }
    }
    /**
     * Check robots.txt allowance
     */
    isAllowedByRobots(normalizedLink) {
        if (this.ignoreRobotsTxt) {
            return true;
        }
        const isAllowed = this.robots.isAllowed(normalizedLink, "DeepScrapeCrawler") ?? true;
        if (!isAllowed) {
            this.logger.debug(`Link disallowed by robots.txt: ${normalizedLink}`);
        }
        return isAllowed;
    }
    /**
     * Validate a single link against all filtering criteria
     */
    isLinkValid(link, maxDepth) {
        let url;
        try {
            url = new url_1.URL(link.trim(), this.baseUrl);
        }
        catch (error) {
            this.logger.debug(`Error processing link: ${link}`, { link, error });
            return false;
        }
        const normalizedLink = this.urlNormalizationService.normalizeUrl(url.toString());
        // Check if URL already visited
        if (this.isUrlVisited(normalizedLink)) {
            return false;
        }
        // Check depth
        const depth = this.getURLDepth(normalizedLink);
        if (depth > maxDepth) {
            return false;
        }
        const path = url.pathname;
        // Check include/exclude patterns
        if (this.isExcludedByPatterns(normalizedLink, path))
            return false;
        if (!this.isIncludedByPatterns(normalizedLink, path))
            return false;
        // Check backward crawling
        if (!this.isBackwardCrawlingAllowed(normalizedLink))
            return false;
        // Check robots.txt
        if (!this.isAllowedByRobots(normalizedLink))
            return false;
        // Check if it's a file
        if (this.isFile(normalizedLink))
            return false;
        return true;
    }
    filterLinks(links, limit, maxDepth, fromMap = false) {
        if (this.currentDiscoveryDepth === this.maxDiscoveryDepth) {
            this.logger.debug("Max discovery depth hit, filtering off all links", {
                currentDiscoveryDepth: this.currentDiscoveryDepth,
                maxDiscoveryDepth: this.maxDiscoveryDepth
            });
            return [];
        }
        if (this.initialUrl.endsWith("sitemap.xml") && fromMap) {
            return links.slice(0, limit);
        }
        return links
            .filter(link => this.isLinkValid(link, maxDepth))
            .slice(0, limit);
    }
    isFile(url) {
        const fileExtensions = [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.zip', '.rar', '.tar', '.gz', '.jpg', '.jpeg', '.png', '.gif',
            '.mp3', '.mp4', '.avi', '.mov', '.exe', '.apk', '.dmg', '.iso'
        ];
        try {
            const parsedUrl = new url_1.URL(url);
            const path = parsedUrl.pathname.toLowerCase();
            return fileExtensions.some(ext => path.endsWith(ext));
        }
        catch (e) {
            return false;
        }
    }
    getURLDepth(url) {
        try {
            const parsedUrl = new url_1.URL(url);
            const path = parsedUrl.pathname.endsWith('/')
                ? parsedUrl.pathname.slice(0, -1)
                : parsedUrl.pathname;
            if (path === '')
                return 0;
            return path.split('/').filter(Boolean).length;
        }
        catch (e) {
            return 0;
        }
    }
    /**
     * Lock a URL to prevent concurrent processing
     */
    lockUrl(url) {
        const normalizedUrl = this.urlNormalizationService.normalizeUrl(url);
        if (this.lockedUrls.has(normalizedUrl)) {
            return false; // Already locked
        }
        // If similar URL deduplication is enabled, check for similar URLs
        if (this.deduplicateSimilarUrls) {
            const similarUrls = this.urlNormalizationService.generateSimilarUrls(normalizedUrl);
            // Check if any similar URL is already locked or visited
            for (const similarUrl of similarUrls) {
                if (this.lockedUrls.has(similarUrl) || this.visited.has(similarUrl)) {
                    return false; // Similar URL already processed
                }
            }
        }
        this.lockedUrls.add(normalizedUrl);
        return true;
    }
    /**
     * Unlock a URL after processing
     */
    unlockUrl(url) {
        const normalizedUrl = this.urlNormalizationService.normalizeUrl(url);
        this.lockedUrls.delete(normalizedUrl);
    }
    /**
     * Check if URL has been visited or is similar to a visited URL
     */
    isUrlVisited(url) {
        const normalizedUrl = this.urlNormalizationService.normalizeUrl(url);
        // Check direct visit
        if (this.visited.has(normalizedUrl)) {
            return true;
        }
        // If similar URL deduplication is enabled, check similar URLs
        if (this.deduplicateSimilarUrls) {
            const similarUrls = this.urlNormalizationService.generateSimilarUrls(normalizedUrl);
            for (const similarUrl of similarUrls) {
                if (this.visited.has(similarUrl)) {
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * Add redirect mapping for URL normalization
     */
    addRedirectMapping(fromUrl, toUrl) {
        const normalizedFrom = this.urlNormalizationService.normalizeUrl(fromUrl);
        const normalizedTo = this.urlNormalizationService.normalizeUrl(toUrl);
        if (normalizedFrom !== normalizedTo) {
            this.redirectMapping.set(normalizedFrom, normalizedTo);
        }
    }
    async getRobotsTxt(skipTlsVerification = false, abort) {
        let extraArgs = {};
        if (skipTlsVerification) {
            extraArgs = {
                httpsAgent: new https_1.default.Agent({
                    rejectUnauthorized: false,
                })
            };
        }
        try {
            const response = await axios_1.default.get(this.robotsTxtUrl, {
                timeout: 10000,
                signal: abort,
                ...extraArgs,
            });
            return response.data;
        }
        catch (error) {
            this.logger.debug(`Failed to get robots.txt from ${this.robotsTxtUrl}`, { error });
            return '';
        }
    }
    importRobotsTxt(txt) {
        this.robots = (0, robots_parser_1.default)(this.robotsTxtUrl, txt);
    }
    async extractLinksFromHtml(html, baseUrl) {
        try {
            const $ = (0, cheerio_1.load)(html);
            const links = [];
            $('a').each((_, element) => {
                const href = $(element).attr('href');
                if (href) {
                    try {
                        const url = new url_1.URL(href, baseUrl);
                        links.push(url.href);
                    }
                    catch (e) {
                        // Invalid URL, ignore
                    }
                }
            });
            return [...new Set(links)]; // Deduplicate links
        }
        catch (error) {
            this.logger.error('Error extracting links from HTML', { error });
            return [];
        }
    }
    /**
     * Execute before crawl hook
     */
    async executeBeforeCrawlHook(normalizedUrl) {
        if (this.hooks.beforeCrawl) {
            await this.hooks.beforeCrawl(normalizedUrl, {
                jobId: this.jobId,
                initialUrl: this.initialUrl,
                includes: this.includes,
                excludes: this.excludes
            });
        }
    }
    /**
     * Apply content processing hooks to HTML
     */
    async applyContentHooks(html, normalizedUrl) {
        let processedHtml = html;
        if (this.hooks.afterPageLoad) {
            processedHtml = await this.hooks.afterPageLoad(processedHtml, normalizedUrl);
        }
        if (this.hooks.beforeContentExtraction) {
            processedHtml = await this.hooks.beforeContentExtraction(processedHtml, normalizedUrl);
        }
        return processedHtml;
    }
    /**
     * Execute error hook
     */
    async executeErrorHook(error, normalizedUrl) {
        if (this.hooks.onError) {
            await this.hooks.onError(error, normalizedUrl);
        }
    }
    /**
     * Configure Playwright options
     */
    getPlaywrightOptions() {
        return {
            waitTime: 2000,
            blockResources: true,
            stealthMode: true,
            maxScrolls: 3,
            ignoreRobotsTxt: this.ignoreRobotsTxt,
            logRequests: false,
            viewport: { width: 1920, height: 1080 }
        };
    }
    /**
     * Initialize Playwright service if needed
     */
    async initializePlaywrightService(options) {
        if (!this.playwrightService) {
            this.playwrightService = new playwright_service_1.PlaywrightService();
            await this.playwrightService.initialize(options);
        }
    }
    /**
     * Crawl page using Playwright
     */
    async crawlWithPlaywright(normalizedUrl) {
        try {
            const playwrightOptions = this.getPlaywrightOptions();
            await this.initializePlaywrightService(playwrightOptions);
            logger_1.logger.info(`Crawling page with Playwright: ${normalizedUrl}`);
            const response = await this.playwrightService.crawlPage(normalizedUrl, playwrightOptions);
            const html = await this.applyContentHooks(response.content, normalizedUrl);
            logger_1.logger.info(`Crawled page with Playwright: ${normalizedUrl} - Found ${response.links.length} links`);
            return { html, links: response.links };
        }
        catch (error) {
            await this.executeErrorHook(error, normalizedUrl);
            logger_1.logger.error(`Error crawling ${normalizedUrl} with Playwright`, { error, url: normalizedUrl });
            return { html: '', links: [] };
        }
    }
    /**
     * Build Axios request configuration
     */
    buildAxiosConfig(normalizedUrl, skipTlsVerification) {
        const config = {
            timeout: 30000,
        };
        if (skipTlsVerification) {
            config.httpsAgent = new https_1.default.Agent({
                rejectUnauthorized: false,
            });
        }
        return config;
    }
    /**
     * Handle redirect mapping
     */
    handleRedirect(response, normalizedUrl) {
        if (response.request?.res?.responseUrl && response.request.res.responseUrl !== normalizedUrl) {
            this.addRedirectMapping(normalizedUrl, response.request.res.responseUrl);
        }
    }
    /**
     * Crawl page using Axios
     */
    async crawlWithAxios(normalizedUrl, skipTlsVerification) {
        try {
            const config = this.buildAxiosConfig(normalizedUrl, skipTlsVerification);
            const response = await axios_1.default.get(normalizedUrl, config);
            this.handleRedirect(response, normalizedUrl);
            const html = await this.applyContentHooks(response.data, normalizedUrl);
            const links = await this.extractLinksFromHtml(html, normalizedUrl);
            return { html, links };
        }
        catch (error) {
            await this.executeErrorHook(error, normalizedUrl);
            logger_1.logger.error(`Error crawling ${normalizedUrl}`, { error, url: normalizedUrl });
            return { html: '', links: [] };
        }
    }
    /**
     * Check if URL can be crawled
     */
    canCrawlUrl(normalizedUrl) {
        if (this.isUrlVisited(normalizedUrl)) {
            return false;
        }
        if (!this.lockUrl(normalizedUrl)) {
            return false;
        }
        return true;
    }
    async crawlPage(url, skipTlsVerification = false) {
        const normalizedUrl = this.urlNormalizationService.normalizeUrl(url);
        await this.executeBeforeCrawlHook(normalizedUrl);
        if (!this.canCrawlUrl(normalizedUrl)) {
            return { html: '', links: [] };
        }
        this.visited.add(normalizedUrl);
        try {
            if (this.useBrowser && this.playwrightService) {
                return await this.crawlWithPlaywright(normalizedUrl);
            }
            else {
                return await this.crawlWithAxios(normalizedUrl, skipTlsVerification);
            }
        }
        finally {
            this.unlockUrl(normalizedUrl);
        }
    }
    addUrlsToQueue(urls) {
        if (urls.length === 0)
            return;
        switch (this.strategy) {
            case crawler_1.CrawlStrategy.DFS:
                this.urlQueue.unshift(...urls);
                break;
            case crawler_1.CrawlStrategy.BEST_FIRST:
                urls.forEach(url => {
                    if (!this.urlScores.has(url)) {
                        const score = this.calculateUrlScore(url);
                        this.urlScores.set(url, score);
                    }
                });
                this.urlQueue.push(...urls);
                this.urlQueue.sort((a, b) => (this.urlScores.get(b) || 0) - (this.urlScores.get(a) || 0));
                break;
            case crawler_1.CrawlStrategy.BFS:
            default:
                this.urlQueue.push(...urls);
                break;
        }
    }
    getNextUrl() {
        if (this.urlQueue.length === 0)
            return undefined;
        return this.urlQueue.shift();
    }
    calculateUrlScore(url) {
        try {
            const parsedUrl = new url_1.URL(url);
            let score = 0;
            const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
            score -= pathSegments.length * 10;
            const queryParams = parsedUrl.searchParams.toString().length;
            score -= queryParams;
            const contentKeywords = ['about', 'docs', 'documentation', 'guide', 'tutorial', 'help'];
            const pathString = parsedUrl.pathname.toLowerCase();
            for (const keyword of contentKeywords) {
                if (pathString.includes(keyword)) {
                    score += 20;
                    break;
                }
            }
            const nonContentKeywords = ['login', 'signup', 'register', 'cart', 'checkout'];
            for (const keyword of nonContentKeywords) {
                if (pathString.includes(keyword)) {
                    score -= 30;
                    break;
                }
            }
            return score;
        }
        catch (e) {
            return -100;
        }
    }
    /**
     * Get the current crawling strategy
     * @returns The strategy name as a string
     */
    getStrategy() {
        return this.strategy || 'bfs';
    }
    /**
     * Discover all URLs from a starting point using browser-based crawling
     * @param maxDepth Maximum depth to discover
     * @param limit Maximum number of URLs to discover
     * @returns Array of discovered URLs
     */
    async discoverUrlsWithBrowser(maxDepth = 3, limit = 100) {
        if (!this.useBrowser) {
            logger_1.logger.warn("Browser-based discovery called but browser mode is not enabled. Switching to browser mode.");
            this.useBrowser = true;
        }
        // Initialize PlaywrightService if not already initialized
        if (!this.playwrightService) {
            this.playwrightService = new playwright_service_1.PlaywrightService();
        }
        // Configure playwright options for discovery
        const playwrightOptions = {
            waitTime: 2000,
            blockResources: true,
            stealthMode: true,
            maxScrolls: 3,
            ignoreRobotsTxt: this.ignoreRobotsTxt,
            discoveryLimit: limit,
            maxDiscoveryDepth: maxDepth,
            includePaths: this.includes,
            excludePaths: this.excludes,
            baseUrl: this.baseUrl,
            // Rate limiting options
            minDelay: 3000, // Minimum 3 seconds between requests
            maxDelay: 30000, // Maximum 30 seconds for backoff
            maxRetries: 3, // Try up to 3 times
            backoffFactor: 2.0, // Double the delay on each retry
            rotateUserAgent: true // Rotate user agents for different requests
        };
        logger_1.logger.info(`Starting browser-based URL discovery from ${this.initialUrl} with depth ${maxDepth} and limit ${limit}`);
        // Run the discovery phase
        const discoveredUrls = await this.playwrightService.discoveryPhase(this.initialUrl, playwrightOptions);
        logger_1.logger.info(`Discovery completed. Found ${discoveredUrls.length} URLs`);
        return discoveredUrls;
    }
    /**
     * Close browser resources when done
     */
    async close() {
        if (this.playwrightService) {
            await this.playwrightService.close();
            this.playwrightService = null;
        }
    }
}
exports.WebCrawler = WebCrawler;
