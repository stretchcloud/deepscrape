"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightService = void 0;
const playwright_1 = require("playwright");
const logger_1 = require("../utils/logger");
const user_agents_1 = __importDefault(require("user-agents"));
const events_1 = require("events");
const browser_pool_service_1 = require("./browser-pool.service");
// Constants
const AD_SERVING_DOMAINS = [
    'doubleclick.net',
    'adservice.google.com',
    'googleadservices.com',
    'google-analytics.com',
    'googletagmanager.com',
    'facebook.com',
    'facebook.net',
    'fbcdn.net',
    'twitter.com',
    'linkedin.com',
    'licdn.com',
    'snapchat.com',
    'ads-twitter.com'
];
// Main service class
class PlaywrightService extends events_1.EventEmitter {
    constructor() {
        super();
        this.browser = null;
        this.context = null;
        this.discoveredUrls = new Set();
        this.crawledUrls = new Set();
        this.urlsToVisit = [];
        this.urlsInProgress = new Set();
        this.totalDiscovered = 0;
        this.totalCrawled = 0;
        this.lastRequestTime = 0;
        // Rate limiting configuration
        this.rateLimit = {
            minDelay: 2000, // Minimum delay between requests (ms)
            maxDelay: 15000, // Maximum delay for backoff (ms)
            maxRetries: 3, // Maximum number of retries
            backoffFactor: 1.5 // Exponential backoff multiplier
        };
        // User agent rotation options
        this.userAgents = [];
        this.currentUserAgentIndex = 0;
        // Add proxy rotation properties
        this.proxyList = [];
        this.currentProxyIndex = 0;
        // Initialize a pool of different user agents for rotation
        this.initUserAgentPool();
    }
    /**
     * Initialize a pool of diverse user agents for rotation
     */
    initUserAgentPool() {
        // Create a diverse pool of user agents
        const userAgentGenerator = new user_agents_1.default();
        // Generate a pool of 10 different user agents
        for (let i = 0; i < 10; i++) {
            const agent = userAgentGenerator.toString();
            this.userAgents.push(agent);
        }
        logger_1.logger.debug(`Initialized pool of ${this.userAgents.length} user agents for rotation`);
    }
    /**
     * Get the next user agent from the rotation pool
     */
    getNextUserAgent() {
        const agent = this.userAgents[this.currentUserAgentIndex];
        this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
        return agent;
    }
    /**
     * Add proxies to the rotation list
     * @param proxies List of proxy URLs (e.g. "http://proxy.example.com:8080")
     */
    addProxies(proxies) {
        if (!proxies || proxies.length === 0)
            return;
        // Add proxies to our list
        this.proxyList.push(...proxies.filter(p => p && p.trim() !== ''));
        logger_1.logger.info(`Added ${proxies.length} proxies to rotation pool. Total: ${this.proxyList.length}`);
    }
    /**
     * Get the next proxy from the rotation pool
     * @returns The next proxy URL or null if none available
     */
    getNextProxy() {
        if (this.proxyList.length === 0)
            return null;
        const proxy = this.proxyList[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length;
        return proxy;
    }
    /**
     * Update rate limiting configuration from options
     */
    updateRateLimitConfig(options) {
        if (options.minDelay)
            this.rateLimit.minDelay = options.minDelay;
        if (options.maxDelay)
            this.rateLimit.maxDelay = options.maxDelay;
        if (options.maxRetries)
            this.rateLimit.maxRetries = options.maxRetries;
        if (options.backoffFactor)
            this.rateLimit.backoffFactor = options.backoffFactor;
    }
    /**
     * Add proxies if provided in options
     */
    addProxiesIfProvided(options) {
        if (options.proxyList && options.proxyList.length > 0) {
            this.addProxies(options.proxyList);
        }
    }
    /**
     * Launch browser with default options
     */
    async launchBrowser() {
        const launchOptions = {
            headless: true,
            args: [
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-setuid-sandbox',
                '--no-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        };
        return await playwright_1.chromium.launch(launchOptions);
    }
    /**
     * Get user agent based on options
     */
    getUserAgent(options) {
        return options.userAgent ||
            (options.rotateUserAgent ? this.getNextUserAgent() : new user_agents_1.default().toString());
    }
    /**
     * Build browser context options
     */
    buildContextOptions(options, userAgent) {
        const contextOptions = {
            userAgent,
            viewport: options.viewport || { width: 1920, height: 1080 },
            ignoreHTTPSErrors: true,
            bypassCSP: true,
            javaScriptEnabled: true,
            extraHTTPHeaders: options.referrer ? { referer: options.referrer } : undefined
        };
        this.addProxyToContext(contextOptions, options);
        return contextOptions;
    }
    /**
     * Add proxy configuration to context options
     */
    addProxyToContext(contextOptions, options) {
        let proxyUrl = options.proxy;
        if (!proxyUrl && options.proxyRotation && this.proxyList.length > 0) {
            const nextProxy = this.getNextProxy();
            if (nextProxy) {
                proxyUrl = nextProxy;
            }
        }
        if (proxyUrl) {
            contextOptions.proxy = {
                server: proxyUrl
            };
            if (options.proxyUsername && options.proxyPassword) {
                contextOptions.proxy.username = options.proxyUsername;
                contextOptions.proxy.password = options.proxyPassword;
            }
            logger_1.logger.info(`Using proxy: ${proxyUrl}`);
        }
    }
    /**
     * Setup context features like stealth mode and resource blocking
     */
    async setupContextFeatures(options) {
        if (options.stealthMode) {
            await this._setupStealthMode(this.context);
            logger_1.logger.info('Stealth mode configured for browser context');
        }
        if (options.blockResources === true) {
            await this._setupResourceBlocking(this.context, options.logRequests || false);
            logger_1.logger.info('Resource blocking configured');
        }
    }
    /**
     * Apply rate limiting delay before making requests
     */
    async applyRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (this.lastRequestTime > 0 && timeSinceLastRequest < this.rateLimit.minDelay) {
            const waitTime = this.rateLimit.minDelay - timeSinceLastRequest;
            if (waitTime > 0) {
                logger_1.logger.debug(`Rate limiting: Waiting ${waitTime}ms before next request`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    /**
     * Handle retry delay with randomization
     */
    async handleRetryDelay(retries, delay, url) {
        if (retries > 0) {
            // Math.random() safe here - used for retry delay randomization to avoid thundering herd
            const randomizedDelay = delay * (0.8 + Math.random() * 0.4);
            logger_1.logger.info(`Retry ${retries}: Waiting ${Math.round(randomizedDelay)}ms before requesting ${url}`);
            await new Promise(resolve => setTimeout(resolve, randomizedDelay));
        }
    }
    /**
     * Check if error is rate limiting related
     */
    isRateLimitError(error) {
        return error.message.includes('429') ||
            error.message.includes('Too Many Requests') ||
            error.message.includes('too many requests');
    }
    /**
     * Handle rate limit retry logic
     */
    async handleRateLimitRetry(url, retries, delay, options) {
        retries++;
        if (retries > this.rateLimit.maxRetries) {
            logger_1.logger.error(`Rate limit exceeded for ${url} after ${retries} retries`);
            return { shouldContinue: false, retries, delay };
        }
        delay = Math.min(this.rateLimit.maxDelay, delay * this.rateLimit.backoffFactor);
        logger_1.logger.warn(`Rate limited on ${url}, retry ${retries}/${this.rateLimit.maxRetries} after ${delay}ms backoff`);
        await this.rotateUserAgentAndProxy(options);
        return { shouldContinue: true, retries, delay };
    }
    /**
     * Rotate user agent and proxy if needed
     */
    async rotateUserAgentAndProxy(options) {
        let needContextReinit = false;
        if (options.rotateUserAgent) {
            const newUserAgent = this.getNextUserAgent();
            logger_1.logger.info(`Rotating user agent to: ${newUserAgent}`);
            options.userAgent = newUserAgent;
            needContextReinit = true;
        }
        if (options.proxyRotation && this.proxyList.length > 0) {
            const newProxy = this.getNextProxy();
            if (newProxy) {
                logger_1.logger.info(`Rotating proxy to: ${newProxy}`);
                options.proxy = newProxy;
                needContextReinit = true;
            }
        }
        if (needContextReinit) {
            await this.reinitializeContext(options);
        }
    }
    /**
     * Reinitialize browser context with new settings
     */
    async reinitializeContext(options) {
        if (!this.browser || !this.context)
            return;
        await this.context.close();
        const contextOptions = this.buildContextOptionsForRetry(options);
        this.context = await this.browser.newContext(contextOptions);
        await this.reapplyContextSettings(options);
    }
    /**
     * Build context options for retry attempts
     */
    buildContextOptionsForRetry(options) {
        const contextOptions = {
            userAgent: options.userAgent,
            viewport: options.viewport || { width: 1920, height: 1080 },
            ignoreHTTPSErrors: true,
            bypassCSP: true,
            javaScriptEnabled: true,
            extraHTTPHeaders: options.referrer ? { referer: options.referrer } : undefined
        };
        if (options.proxy) {
            contextOptions.proxy = {
                server: options.proxy
            };
            if (options.proxyUsername && options.proxyPassword) {
                contextOptions.proxy.username = options.proxyUsername;
                contextOptions.proxy.password = options.proxyPassword;
            }
        }
        return contextOptions;
    }
    /**
     * Reapply stealth and blocking settings to new context
     */
    async reapplyContextSettings(options) {
        if (options.stealthMode) {
            await this._setupStealthMode(this.context);
        }
        if (options.blockResources === true) {
            await this._setupResourceBlocking(this.context, options.logRequests || false);
        }
    }
    /**
     * Ensure browser and context are initialized
     */
    async ensureBrowserContext(options) {
        if (!this.browser || !this.context) {
            await this.initialize(options);
        }
        if (!this.context) {
            throw new Error('Browser context not initialized');
        }
    }
    /**
     * Navigate to URL with timeout retry logic
     */
    async navigateWithRetry(page, url) {
        let timeoutRetries = 0;
        const maxTimeoutRetries = 2;
        let response;
        while (timeoutRetries <= maxTimeoutRetries) {
            try {
                response = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000
                });
                break;
            }
            catch (error) {
                if (this.isTimeoutError(error)) {
                    timeoutRetries++;
                    if (timeoutRetries > maxTimeoutRetries) {
                        throw error;
                    }
                    logger_1.logger.warn(`Navigation timeout for ${url}, retrying (${timeoutRetries}/${maxTimeoutRetries})...`);
                    response = await this.retryWithDifferentStrategy(page, url);
                    if (response)
                        break;
                }
                else {
                    throw error;
                }
            }
        }
        return response;
    }
    /**
     * Check if error is a timeout error
     */
    isTimeoutError(error) {
        return error instanceof Error && error.message.includes('timeout');
    }
    /**
     * Retry navigation with different strategy
     */
    async retryWithDifferentStrategy(page, url) {
        try {
            const response = await page.goto(url, {
                waitUntil: 'load',
                timeout: 60000
            });
            logger_1.logger.info(`Retry succeeded with 'load' strategy for ${url}`);
            return response;
        }
        catch (retryError) {
            if (this.isTimeoutError(retryError)) {
                logger_1.logger.warn(`Retry failed with 'load' strategy for ${url}, trying again...`);
                return null;
            }
            throw retryError;
        }
    }
    /**
     * Handle error status codes
     */
    handleErrorStatus(url, status) {
        if (status === 429) {
            throw new Error(`Too Many Requests (429) for URL: ${url}`);
        }
        logger_1.logger.warn(`Error status code: ${status} for URL: ${url}`);
        return {
            content: '',
            links: [],
            url,
            status
        };
    }
    /**
     * Wait for page load and perform scrolling
     */
    async waitAndScroll(page, options) {
        const waitTime = options.waitTime || 1000;
        await page.waitForTimeout(waitTime);
        logger_1.logger.debug(`Waited for ${waitTime}ms after page load`);
        await this._simulateHumanScrolling(page, options.maxScrolls || 3);
    }
    /**
     * Extract page content, title, and links
     */
    async extractPageData(page) {
        const links = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            return anchors
                .map(anchor => anchor.href)
                .filter(href => {
                // Security: Filter out dangerous protocol schemes that could execute code
                // This prevents javascript: URLs from being followed, which would be unsafe
                if (!href || typeof href !== 'string')
                    return false;
                const lowerHref = href.toLowerCase();
                const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:'];
                return !dangerousProtocols.some(protocol => lowerHref.startsWith(protocol));
            })
                .map(href => {
                try {
                    return new URL(href).toString();
                }
                catch {
                    return null;
                }
            })
                .filter((url) => url !== null);
        });
        logger_1.logger.info(`Extracted ${links.length} links from page`);
        const content = await page.content();
        const title = await page.title();
        return { content, title, links };
    }
    /**
     * Initialize the browser and browser context with specified options
     * @param options The playwright options
     * @returns The initialized browser and context
     */
    async initialize(options = {}) {
        logger_1.logger.info('Initializing Playwright browser...');
        this.updateRateLimitConfig(options);
        this.addProxiesIfProvided(options);
        this.browser = await this.launchBrowser();
        logger_1.logger.info('Browser launched successfully');
        const userAgent = this.getUserAgent(options);
        const contextOptions = this.buildContextOptions(options, userAgent);
        this.context = await this.browser.newContext(contextOptions);
        logger_1.logger.info(`Created browser context with user agent: ${userAgent}`);
        await this.setupContextFeatures(options);
        return { browser: this.browser, context: this.context };
    }
    /**
     * Crawl a specific URL and extract content with retry logic
     * @param url The URL to crawl
     * @param options The playwright options
     * @returns The crawl response with content, links, etc.
     */
    async crawlPage(url, options = {}) {
        await this.applyRateLimit();
        let retries = 0;
        let delay = this.rateLimit.minDelay;
        let lastError = null;
        while (retries <= this.rateLimit.maxRetries) {
            try {
                await this.handleRetryDelay(retries, delay, url);
                this.lastRequestTime = Date.now();
                return await this._performCrawl(url, options);
            }
            catch (error) {
                lastError = error;
                logger_1.logger.error(`Error crawling ${url}: ${error.message}`);
                if (this.isRateLimitError(error)) {
                    const retryResult = await this.handleRateLimitRetry(url, retries, delay, options);
                    if (!retryResult.shouldContinue) {
                        break;
                    }
                    retries = retryResult.retries;
                    delay = retryResult.delay;
                    continue;
                }
                throw error;
            }
        }
        throw lastError || new Error(`Failed to crawl ${url} after ${retries} retries`);
    }
    /**
     * Perform the actual crawling operation without retry logic
     * @param url The URL to crawl
     * @param options The playwright options
     * @returns The crawl response
     */
    async _performCrawl(url, options = {}) {
        // 🚀 USE BROWSER POOL instead of creating new browser instances
        const { page, browserId, contextId } = await browser_pool_service_1.browserPool.getPage();
        logger_1.logger.info(`Crawling page: ${url}`, { browserId, contextId });
        try {
            await this._addHumanBehavior(page);
            const response = await this.navigateWithRetry(page, url);
            const status = response?.status() || 200;
            logger_1.logger.info(`Page loaded with status: ${status}`, { browserId });
            if (status >= 400) {
                return this.handleErrorStatus(url, status);
            }
            await this.waitAndScroll(page, options);
            const { content, title, links } = await this.extractPageData(page);
            return {
                content,
                links,
                url,
                title,
                status
            };
        }
        catch (error) {
            logger_1.logger.error(`Error crawling ${url}: ${error.message}`, { browserId });
            throw error;
        }
        finally {
            // 🚀 RELEASE PAGE back to browser pool instead of closing browser
            await browser_pool_service_1.browserPool.releasePage(page, browserId, contextId, false);
            logger_1.logger.debug(`Page released to browser pool for URL: ${url}`, { browserId });
        }
    }
    /**
     * Add randomized human-like behavior before page navigation
     * @param page The Playwright page
     */
    async _addHumanBehavior(page) {
        try {
            // Random mouse movements
            const viewport = page.viewportSize();
            if (viewport) {
                const { width, height } = viewport;
                // Move mouse to 2-4 random positions before navigation
                // Math.random() safe here - used for simulating natural human mouse behavior
                const movements = 2 + Math.floor(Math.random() * 3);
                for (let i = 0; i < movements; i++) {
                    const x = Math.floor(Math.random() * width);
                    const y = Math.floor(Math.random() * (height / 2)); // Focus on upper half
                    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 20) });
                    // Add random pause between movements
                    await page.waitForTimeout(100 + Math.floor(Math.random() * 200));
                }
            }
        }
        catch (error) {
            // Don't fail if human behavior simulation fails
            logger_1.logger.debug('Error simulating human behavior, continuing with navigation');
        }
    }
    /**
     * Simulate human-like scrolling behavior with random pauses
     * @param page The Playwright page
     * @param maxScrolls Maximum number of scroll actions
     */
    async _simulateHumanScrolling(page, maxScrolls) {
        try {
            logger_1.logger.debug(`Performing human-like scrolling with ${maxScrolls} scrolls`);
            for (let i = 0; i < maxScrolls; i++) {
                // Get current scroll position and total height
                const { scrollTop, scrollHeight, clientHeight } = await page.evaluate(() => {
                    return {
                        scrollTop: document.documentElement.scrollTop,
                        scrollHeight: document.documentElement.scrollHeight,
                        clientHeight: document.documentElement.clientHeight
                    };
                });
                // Check if we're already at the bottom
                if (scrollTop + clientHeight >= scrollHeight) {
                    logger_1.logger.debug('Reached bottom of page, stopping scroll simulation');
                    break;
                }
                // Scroll a random amount (between 100px and viewport height)
                // Math.random() safe here - for natural scrolling simulation
                const scrollAmount = 100 + Math.floor(Math.random() * (clientHeight - 100));
                // Use a more human-like scroll with variable speed
                await page.evaluate((scrollAmount) => {
                    return new Promise((resolve) => {
                        let scrolled = 0;
                        const totalScroll = scrollAmount;
                        const duration = 500 + Math.random() * 500; // Random duration between 500-1000ms
                        const startTime = Date.now();
                        function step() {
                            const now = Date.now();
                            const elapsed = now - startTime;
                            if (elapsed >= duration) {
                                window.scrollBy(0, totalScroll - scrolled);
                                resolve();
                                return;
                            }
                            // Easing function for more natural motion
                            const progress = elapsed / duration;
                            const easedProgress = 0.5 - Math.cos(progress * Math.PI) / 2;
                            const currentScroll = Math.floor(easedProgress * totalScroll) - scrolled;
                            scrolled += currentScroll;
                            window.scrollBy(0, currentScroll);
                            requestAnimationFrame(step);
                        }
                        requestAnimationFrame(step);
                    });
                }, scrollAmount);
                // Add random pause between scrolls (500-2000ms)
                const pauseTime = 500 + Math.floor(Math.random() * 1500);
                await page.waitForTimeout(pauseTime);
                logger_1.logger.debug(`Scrolled and waited ${pauseTime}ms`);
            }
        }
        catch (error) {
            // Don't fail if scrolling fails
            logger_1.logger.debug('Error during human-like scrolling, continuing with extraction');
        }
    }
    /**
     * Run a discovery phase to find all URLs to crawl
     * @param startUrl The URL to start discovery from
     * @param options The playwright options
     * @returns The discovered URLs
     */
    async discoveryPhase(startUrl, options = {}) {
        logger_1.logger.info(`Starting discovery phase from: ${startUrl}`);
        this.discoveredUrls = new Set();
        this.crawledUrls = new Set();
        this.urlsToVisit = [startUrl];
        this.urlsInProgress = new Set();
        this.totalDiscovered = 0;
        this.totalCrawled = 0;
        const maxDepth = options.maxDiscoveryDepth || 3;
        const limit = options.discoveryLimit || 100;
        const includePaths = options.includePaths || [];
        const excludePaths = options.excludePaths || [];
        const excludeDomains = options.excludeDomains || [];
        const baseUrl = options.baseUrl || new URL(startUrl).origin;
        // Add the start URL to the discovered set
        this.discoveredUrls.add(startUrl);
        this.totalDiscovered++;
        let currentDepth = 0;
        while (currentDepth < maxDepth && this.crawledUrls.size < limit && this.urlsToVisit.length > 0) {
            logger_1.logger.info(`Discovery phase - Depth: ${currentDepth + 1}/${maxDepth}, Discovered: ${this.totalDiscovered}, Crawled: ${this.totalCrawled}`);
            // Get the current level URLs
            const currentLevelUrls = [...this.urlsToVisit];
            this.urlsToVisit = [];
            // Process all URLs at the current level in parallel for maximum performance
            await Promise.all(currentLevelUrls.map(async (url) => {
                if (this.crawledUrls.size >= limit)
                    return;
                if (this.crawledUrls.has(url) || this.urlsInProgress.has(url))
                    return;
                this.urlsInProgress.add(url);
                try {
                    const response = await this.crawlPage(url, options);
                    this.crawledUrls.add(url);
                    this.totalCrawled++;
                    // Filter and add new links
                    const newLinks = response.links.filter(link => {
                        if (!link)
                            return false;
                        try {
                            const linkUrl = new URL(link);
                            // Skip if not same origin
                            if (linkUrl.origin !== new URL(baseUrl).origin)
                                return false;
                            // Skip if already discovered
                            if (this.discoveredUrls.has(link))
                                return false;
                            // Skip if in excluded domains
                            if (excludeDomains.some(domain => linkUrl.hostname.includes(domain)))
                                return false;
                            // Check include paths
                            const matchesIncludePath = includePaths.length === 0 ||
                                includePaths.some(pattern => new RegExp(pattern).test(linkUrl.pathname));
                            // Check exclude paths
                            const matchesExcludePath = excludePaths.length > 0 &&
                                excludePaths.some(pattern => new RegExp(pattern).test(linkUrl.pathname));
                            return matchesIncludePath && !matchesExcludePath;
                        }
                        catch {
                            return false;
                        }
                    });
                    // Add new links to discovered set and to visit queue
                    for (const link of newLinks) {
                        if (!this.discoveredUrls.has(link)) {
                            this.discoveredUrls.add(link);
                            this.urlsToVisit.push(link);
                            this.totalDiscovered++;
                            // Emit an event for each new discovered URL
                            this.emit('url-discovered', {
                                url: link,
                                totalDiscovered: this.totalDiscovered
                            });
                            if (this.totalDiscovered >= limit)
                                break;
                        }
                    }
                    // Emit crawled event
                    this.emit('url-crawled', {
                        url,
                        totalCrawled: this.totalCrawled,
                        newUrls: newLinks.length
                    });
                }
                catch (error) {
                    logger_1.logger.error(`Error in discovery for ${url}: ${error.message}`);
                }
                finally {
                    this.urlsInProgress.delete(url);
                }
            }));
            currentDepth++;
        }
        logger_1.logger.info(`Discovery phase completed. Total discovered: ${this.totalDiscovered}, Total crawled: ${this.totalCrawled}`);
        return Array.from(this.discoveredUrls);
    }
    /**
     * Enhanced discovery phase with configurable multi-level crawling
     */
    async enhancedDiscoveryPhase(startUrl, options = {}) {
        logger_1.logger.info(`Starting enhanced discovery phase from: ${startUrl}`);
        this.discoveredUrls = new Set();
        this.crawledUrls = new Set();
        this.urlsToVisit = [startUrl];
        this.urlsInProgress = new Set();
        this.totalDiscovered = 0;
        this.totalCrawled = 0;
        const maxDepth = options.maxDiscoveryDepth || 3;
        const limit = options.discoveryLimit || 100;
        const maxConcurrency = options.maxConcurrency || 8;
        const maxLinksPerPage = options.maxLinksPerPage || 100;
        const enableDeepCrawling = options.enableDeepCrawling !== false;
        const includePaths = options.includePaths || [];
        const excludePaths = options.excludePaths || [];
        const excludeDomains = options.excludeDomains || [];
        const baseUrl = options.baseUrl || new URL(startUrl).origin;
        // Add the start URL to the discovered set
        this.discoveredUrls.add(startUrl);
        this.totalDiscovered++;
        let currentDepth = 0;
        while (currentDepth < maxDepth && this.crawledUrls.size < limit && this.urlsToVisit.length > 0) {
            logger_1.logger.info(`Enhanced discovery - Depth: ${currentDepth + 1}/${maxDepth}, Discovered: ${this.totalDiscovered}, Crawled: ${this.totalCrawled}, Queue: ${this.urlsToVisit.length}`);
            // Get the current level URLs
            const currentLevelUrls = [...this.urlsToVisit];
            this.urlsToVisit = [];
            // Process URLs in controlled concurrency batches for optimal performance
            const batches = [];
            for (let i = 0; i < currentLevelUrls.length; i += maxConcurrency) {
                batches.push(currentLevelUrls.slice(i, i + maxConcurrency));
            }
            for (const batch of batches) {
                if (this.crawledUrls.size >= limit)
                    break;
                // Process batch concurrently with controlled parallelism
                await Promise.allSettled(batch.map(url => this.processUrlInBatch(url, limit, browser_pool_service_1.browserPool, options, maxLinksPerPage, baseUrl, includePaths, excludePaths, excludeDomains, enableDeepCrawling, currentDepth)));
                // Add a small delay between batches to prevent overwhelming the target server
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            currentDepth++;
            // If deep crawling is disabled, only process the first depth level
            if (!enableDeepCrawling && currentDepth >= 1) {
                logger_1.logger.info('Deep crawling disabled, stopping after first level');
                break;
            }
        }
        logger_1.logger.info(`Enhanced discovery phase completed`, {
            totalDiscovered: this.totalDiscovered,
            totalCrawled: this.totalCrawled,
            maxDepthReached: currentDepth,
            enableDeepCrawling
        });
        return Array.from(this.discoveredUrls);
    }
    /**
     * Enhanced page crawling using browser pool
     */
    async crawlPageEnhanced(page, url, options) {
        const maxLinksPerPage = options.maxLinksPerPage || 100;
        try {
            // Set page timeout
            page.setDefaultTimeout(7000);
            page.setDefaultNavigationTimeout(7000);
            // Navigate with timeout
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 7000
            });
            // Wait for any dynamic content (reduced from 1000ms)
            await page.waitForTimeout(500);
            // Extract content and links with timeout
            const result = await Promise.race([
                page.evaluate((maxLinks) => {
                    const title = document.title;
                    const content = document.body?.innerText || '';
                    // Get all links and limit them
                    const linkElements = Array.from(document.querySelectorAll('a[href]'));
                    const links = linkElements
                        .map(el => el.href)
                        .filter(href => href && href.startsWith('http'))
                        .slice(0, maxLinks); // Limit links per page
                    return { title, content, links };
                }, maxLinksPerPage),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Page evaluation timeout')), 5000))
            ]);
            return {
                content: result.content,
                links: result.links,
                url,
                title: result.title,
                status: 200
            };
        }
        catch (error) {
            logger_1.logger.warn(`Failed to crawl page: ${url}`, { error: error.message });
            return {
                content: '',
                links: [],
                url,
                status: 0
            };
        }
    }
    /**
     * Enhanced link filtering with configurable limits
     */
    filterDiscoveredLinks(links, baseUrl, includePaths, excludePaths, excludeDomains, maxLinksPerPage) {
        const filtered = links.filter(link => {
            if (!link)
                return false;
            try {
                const linkUrl = new URL(link);
                // Remove fragments (#) from URLs to avoid duplicate crawling
                linkUrl.hash = '';
                const cleanLink = linkUrl.toString();
                // Skip if not same origin
                if (linkUrl.origin !== new URL(baseUrl).origin)
                    return false;
                // Skip if already discovered (check clean URL)
                if (this.discoveredUrls.has(cleanLink))
                    return false;
                // Skip if in excluded domains
                if (excludeDomains.some(domain => linkUrl.hostname.includes(domain)))
                    return false;
                // Check include paths
                const matchesIncludePath = includePaths.length === 0 ||
                    includePaths.some(pattern => new RegExp(pattern).test(linkUrl.pathname));
                // Check exclude paths
                const matchesExcludePath = excludePaths.length > 0 &&
                    excludePaths.some(pattern => new RegExp(pattern).test(linkUrl.pathname));
                return matchesIncludePath && !matchesExcludePath;
            }
            catch {
                return false;
            }
        });
        // Limit the number of links processed per page
        return filtered.slice(0, maxLinksPerPage);
    }
    /**
     * Process a single URL in a batch during enhanced discovery
     */
    async processUrlInBatch(url, limit, browserPool, options, maxLinksPerPage, baseUrl, includePaths, excludePaths, excludeDomains, enableDeepCrawling, currentDepth) {
        if (this.crawledUrls.size >= limit)
            return;
        if (this.crawledUrls.has(url) || this.urlsInProgress.has(url))
            return;
        if (!this.shouldProcessUrl(url))
            return;
        this.urlsInProgress.add(url);
        try {
            const { page, browserId } = await this.acquirePageWithTimeout(browserPool);
            try {
                const response = await this.crawlPageEnhanced(page, url, {
                    ...options,
                    maxLinksPerPage
                });
                await this.processDiscoveryResponse(url, response, baseUrl, includePaths, excludePaths, excludeDomains, enableDeepCrawling, currentDepth, limit);
            }
            finally {
                await this.releasePageSafely(page, browserId, browserPool, url);
            }
        }
        catch (error) {
            this.handleDiscoveryError(error, url, currentDepth);
        }
        finally {
            this.urlsInProgress.delete(url);
        }
    }
    /**
     * Check if URL should be processed based on filtering rules
     */
    shouldProcessUrl(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname.toLowerCase();
            const search = urlObj.search.toLowerCase();
            // Skip login, signup, and authentication pages
            if (path.includes('/signin') || path.includes('/login') ||
                path.includes('/signup') || path.includes('/register') ||
                search.includes('signin') || search.includes('continue=')) {
                return false;
            }
            // Skip pages with language parameters that might be duplicates
            if (search.includes('hl=') && !search.includes('hl=en')) {
                return false;
            }
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Acquire page from browser pool with timeout
     */
    async acquirePageWithTimeout(browserPool) {
        return Promise.race([
            browserPool.getPage(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Browser pool timeout')), 10000))
        ]);
    }
    /**
     * Process discovery response and add new URLs
     */
    async processDiscoveryResponse(url, response, baseUrl, includePaths, excludePaths, excludeDomains, enableDeepCrawling, currentDepth, limit) {
        this.crawledUrls.add(url);
        this.totalCrawled++;
        const newLinks = this.filterDiscoveredLinks(response.links, baseUrl, includePaths, excludePaths, excludeDomains, 100);
        for (const link of newLinks) {
            const cleanUrl = new URL(link);
            cleanUrl.hash = '';
            const cleanLink = cleanUrl.toString();
            if (!this.discoveredUrls.has(cleanLink)) {
                this.discoveredUrls.add(cleanLink);
                if (enableDeepCrawling) {
                    this.urlsToVisit.push(cleanLink);
                }
                this.totalDiscovered++;
                this.emit('url-discovered', {
                    url: cleanLink,
                    totalDiscovered: this.totalDiscovered,
                    depth: currentDepth + 1
                });
                if (this.totalDiscovered >= limit)
                    break;
            }
        }
        this.emit('url-crawled', {
            url,
            totalCrawled: this.totalCrawled,
            newUrls: newLinks.length,
            depth: currentDepth + 1
        });
    }
    /**
     * Safely release page back to browser pool
     */
    async releasePageSafely(page, browserId, browserPool, url) {
        try {
            await browserPool.releasePage(page, browserId);
        }
        catch (releaseError) {
            logger_1.logger.warn(`Failed to release page for ${url}`, {
                error: releaseError.message
            });
        }
    }
    /**
     * Handle discovery errors with appropriate logging
     */
    handleDiscoveryError(error, url, currentDepth) {
        const errorMessage = error.message;
        if (!errorMessage.includes('Browser pool timeout') &&
            !errorMessage.includes('Page evaluation timeout')) {
            logger_1.logger.error(`Enhanced discovery error for ${url}`, {
                error: errorMessage,
                depth: currentDepth + 1
            });
        }
    }
    /**
     * Close the browser and context
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            logger_1.logger.info('Browser closed successfully');
        }
    }
    /**
     * Set up stealth mode for browser context
     * @param context The browser context
     */
    async _setupStealthMode(context) {
        await context.addInitScript(function () {
            // Store original navigator and WebGL
            window._originalNavigator = window.navigator;
            window._originalWebGL = window.WebGLRenderingContext.prototype.getParameter;
            window._originalWebGL2 = window.WebGL2RenderingContext?.prototype.getParameter;
            // Override WebGL fingerprinting methods
            const getParameterProxyHandler = {
                apply: function (target, thisArg, args) {
                    // Return modified values for fingerprinting parameters
                    const param = args[0];
                    if (param === 37445) {
                        return 'Google Inc. (Intel)';
                    }
                    if (param === 37446) {
                        return 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics OpenGL 4.1)';
                    }
                    return target.apply(thisArg, args);
                }
            };
            // Apply the proxy to WebGL methods
            if (window.WebGLRenderingContext) {
                window.WebGLRenderingContext.prototype.getParameter = new Proxy(window.WebGLRenderingContext.prototype.getParameter, getParameterProxyHandler);
            }
            if (window.WebGL2RenderingContext) {
                window.WebGL2RenderingContext.prototype.getParameter = new Proxy(window.WebGL2RenderingContext.prototype.getParameter, getParameterProxyHandler);
            }
            // Mock permissions API to make it always return granted
            if (navigator.permissions) {
                navigator.permissions.query = async function (permissionDesc) {
                    return Promise.resolve({
                        state: 'granted',
                        onchange: null
                    });
                };
            }
            // Modify navigator properties to avoid detection
            const modifyNavigator = function () {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false
                });
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        // Create a plugins array that satisfies PluginArray interface
                        const plugins = [];
                        // Add a fake plugin
                        Object.defineProperty(plugins, 'length', { value: 1 });
                        Object.defineProperty(plugins, '0', {
                            value: {
                                name: 'Chrome PDF Plugin',
                                filename: 'internal-pdf-viewer',
                                description: 'Portable Document Format'
                            }
                        });
                        return plugins;
                    }
                });
            };
            modifyNavigator();
        });
    }
    /**
     * Set up resource blocking for the browser context
     * @param context The browser context
     * @param logRequests Whether to log blocked requests
     */
    async _setupResourceBlocking(context, logRequests) {
        // Block ad networks and unnecessary resources
        await context.route('**/*', (route, request) => {
            const url = request.url();
            const resourceType = request.resourceType();
            // Block ad serving domains
            const isAdDomain = AD_SERVING_DOMAINS.some(domain => url.includes(domain));
            // Block unnecessary resource types - expanded list
            const blockResourceTypes = ['image', 'media', 'font', 'other', 'websocket', 'eventsource'];
            // Block tracking and analytics scripts
            const trackingKeywords = ['tracking', 'analytics', 'telemetry', 'metrics', 'stats', 'pixel', 'gtm', 'ga', 'facebook', 'twitter', 'linkedin'];
            const isTrackingResource = trackingKeywords.some(keyword => url.toLowerCase().includes(keyword));
            // Special handling for Microsoft Docs - we know these aren't essential
            const isMicrosoftDocs = url.includes('learn.microsoft.com');
            const microsoftNonEssential = isMicrosoftDocs && (url.includes('click') ||
                url.includes('feedback') ||
                url.includes('rating') ||
                url.includes('tracking') ||
                url.includes('telemetry') ||
                url.includes('analytics') ||
                url.includes('.gif') ||
                url.includes('.jpg') ||
                url.includes('.png') ||
                url.includes('.svg'));
            // Microsoft Docs specific - allow essential resources
            const isMicrosoftEssential = isMicrosoftDocs && (url.includes('main.js') ||
                url.includes('essential') ||
                url.includes('critical') ||
                url.includes('content') ||
                resourceType === 'document');
            // Determine if request should be blocked
            const shouldBlock = isAdDomain ||
                isTrackingResource ||
                microsoftNonEssential ||
                (blockResourceTypes.includes(resourceType) && !isMicrosoftEssential);
            if (shouldBlock) {
                if (logRequests) {
                    logger_1.logger.debug(`Blocked request: ${resourceType} - ${url}`);
                }
                route.abort();
            }
            else {
                route.continue();
            }
        });
    }
    /**
     * Simplified URL discovery method for the URLDiscoveryService
     * @param startUrl The starting URL for discovery
     * @param options Discovery options
     * @returns Array of discovered URLs
     */
    async discoverUrls(startUrl, options = {}) {
        const { maxDepth = 3, discoveryLimit = 100, timeout = 15000, maxConcurrency = 8, maxLinksPerPage = 100, enableDeepCrawling = true, browserPoolSize = 5 } = options;
        try {
            logger_1.logger.info('Starting enhanced URL discovery', {
                startUrl,
                maxDepth,
                discoveryLimit,
                maxConcurrency,
                maxLinksPerPage,
                enableDeepCrawling,
                browserPoolSize
            });
            const playwrightOptions = {
                maxDiscoveryDepth: maxDepth,
                discoveryLimit,
                timeout,
                maxConcurrency,
                maxLinksPerPage,
                enableDeepCrawling,
                includePaths: [],
                excludePaths: [],
                excludeDomains: [],
                baseUrl: new URL(startUrl).origin
            };
            const urls = await this.enhancedDiscoveryPhase(startUrl, playwrightOptions);
            return urls.slice(0, discoveryLimit);
        }
        catch (error) {
            logger_1.logger.warn('Enhanced browser-based URL discovery failed', {
                startUrl,
                error: error.message
            });
            return [];
        }
    }
}
exports.PlaywrightService = PlaywrightService;
// Singleton instance
const playwrightService = new PlaywrightService();
exports.default = playwrightService;
