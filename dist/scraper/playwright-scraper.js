"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightScraper = void 0;
const playwright_1 = require("playwright");
const crypto_1 = require("crypto");
const logger_1 = require("../utils/logger");
const types_1 = require("../types");
const playwright_service_1 = require("../services/playwright.service");
/**
 * Browser-based scraper using Playwright
 */
class PlaywrightScraper {
    constructor() {
        this.playwrightService = new playwright_service_1.PlaywrightService();
    }
    /**
     * Determine if URL is an e-commerce site requiring special handling
     */
    isEcommerceSite(url) {
        const isAmazon = url.includes('amazon.com') || url.includes('amazon.');
        const isEcommerce = isAmazon || url.includes('walmart.com') || url.includes('bestbuy.com');
        return { isEcommerce, isAmazon };
    }
    /**
     * Get default scraper options
     */
    getDefaultOptions(options) {
        return {
            timeout: options.timeout ?? 30000,
            blockAds: options.blockAds !== false,
            blockResources: options.blockResources !== false,
            userAgent: options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    }
    /**
     * Build browser launch options
     */
    buildLaunchOptions(options, isEcommerce) {
        const launchOptions = {
            headless: !isEcommerce, // Use non-headless for e-commerce to bypass bot detection
            executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ],
            ...options.puppeteerLaunchOptions
        };
        if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
        }
        return launchOptions;
    }
    /**
     * Setup e-commerce specific context (cookies and headers)
     */
    async setupEcommerceContext(context, isEcommerce) {
        if (!isEcommerce)
            return;
        const timestamp = Date.now();
        const sessionId = `${timestamp.toString(36)}-${(0, crypto_1.randomBytes)(8).toString('hex')}`;
        const ubidValue = `${timestamp.toString(36)}-${(0, crypto_1.randomBytes)(12).toString('hex')}`;
        await context.addCookies([
            { name: 'session-id', value: sessionId, domain: '.amazon.com', path: '/' },
            { name: 'ubid-main', value: ubidValue, domain: '.amazon.com', path: '/' }
        ]);
        await context.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Ch-Ua': '"Google Chrome";v="120", "Chromium";v="120", "Not=A?Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1'
        });
    }
    /**
     * Setup page with blocking and headers
     */
    async setupPage(page, options, blockAds, blockResources) {
        if (blockAds || blockResources) {
            await this.setupResourceBlocking(page, blockAds, blockResources);
        }
        if (options.headers) {
            await page.setExtraHTTPHeaders(options.headers);
        }
    }
    /**
     * Navigate to URL with Amazon-specific logic
     */
    async navigateToUrl(page, url, isAmazon, timeout) {
        logger_1.logger.info(`Navigating to URL: ${url}`);
        if (isAmazon) {
            await page.goto('https://www.amazon.com', { timeout, waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000 + Math.random() * 1000);
            await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
        }
        else {
            await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
        }
    }
    /**
     * Handle post-navigation actions and waits
     */
    async handlePostNavigation(page, url, options, isAmazon, timeout) {
        // Wait for selector if provided
        if (options.waitForSelector) {
            logger_1.logger.info(`Waiting for selector: ${options.waitForSelector}`);
            try {
                await page.waitForSelector(options.waitForSelector, { timeout });
            }
            catch (error) {
                logger_1.logger.warn(`Timeout waiting for selector: ${options.waitForSelector}, error: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        // Amazon-specific scrolling
        if (isAmazon) {
            logger_1.logger.info('Performing random scrolling for Amazon page');
            await this.performRandomScrolling(page);
        }
        // Additional wait time
        const waitTime = options.waitForTimeout ?? 0;
        if (waitTime > 0) {
            logger_1.logger.info(`Waiting additional ${waitTime}ms`);
            await page.waitForTimeout(waitTime);
        }
        // Execute actions
        if (options.actions && options.actions.length > 0) {
            logger_1.logger.info(`Executing ${options.actions.length} actions`);
            await this.performActions(page, options.actions);
        }
    }
    /**
     * Extract page metadata and content
     */
    async extractPageData(page, url, isAmazon, options) {
        const title = await page.title();
        // Get response info
        let status = 0;
        let headers = {};
        try {
            const responseInfo = await page.evaluate(() => {
                const perf = window.performance.getEntriesByType('navigation')[0];
                return {
                    status: perf?.responseStatus ?? 0,
                    headers: {}
                };
            });
            status = responseInfo.status;
        }
        catch (error) {
            logger_1.logger.warn(`Could not get response info: ${error}`);
        }
        // Extract content
        const content = isAmazon ?
            await this.extractAmazonProductData(page) :
            await page.content();
        // Take screenshot if requested
        let screenshot;
        if (options.fullPage) {
            screenshot = await page.screenshot({ fullPage: true, type: 'png' });
        }
        return { title, content, status, headers, screenshot };
    }
    /**
     * Create error response
     */
    createErrorResponse(url, error) {
        return {
            url,
            title: '',
            content: '',
            contentType: 'html',
            metadata: {
                timestamp: new Date().toISOString(),
                status: 0,
                headers: {}
            },
            error: `Scraping error: ${error instanceof Error ? error.message : String(error)}`
        };
    }
    /**
     * Scrape a URL using Playwright
     */
    async scrape(url, options = {}) {
        const startTime = Date.now();
        try {
            if (options.useBrowser) {
                return await this.scrapeWithPlaywrightService(url, options);
            }
            const { isEcommerce, isAmazon } = this.isEcommerceSite(url);
            const { timeout, blockAds, blockResources, userAgent } = this.getDefaultOptions(options);
            let browser = null;
            try {
                if (isEcommerce) {
                    logger_1.logger.info('E-commerce site detected, using enhanced anti-bot measures');
                }
                logger_1.logger.info(`Launching browser with options: ${JSON.stringify(options.puppeteerLaunchOptions ?? {})}`);
                const launchOptions = this.buildLaunchOptions(options, isEcommerce);
                browser = await playwright_1.chromium.launch(launchOptions);
                const context = await browser.newContext({
                    userAgent,
                    viewport: { width: 1920, height: 1080 },
                    ignoreHTTPSErrors: true
                });
                await this.setupEcommerceContext(context, isEcommerce);
                const page = await context.newPage();
                await this.setupPage(page, options, blockAds, blockResources);
                await this.navigateToUrl(page, url, isAmazon, timeout);
                await this.handlePostNavigation(page, url, options, isAmazon, timeout);
                const { title, content, status, headers, screenshot } = await this.extractPageData(page, url, isAmazon, options);
                const loadTime = Date.now() - startTime;
                logger_1.logger.info(`Page loaded in ${loadTime}ms`);
                return {
                    url,
                    title,
                    content,
                    contentType: 'html',
                    metadata: {
                        timestamp: new Date().toISOString(),
                        status,
                        headers,
                        loadTime
                    },
                    screenshot
                };
            }
            finally {
                if (browser) {
                    logger_1.logger.info('Closing browser');
                    await browser.close();
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`Error scraping URL: ${error instanceof Error ? error.message : String(error)}`);
            return this.createErrorResponse(url, error);
        }
    }
    /**
     * Scrape URL using the enhanced PlaywrightService with rate limiting and stealth
     */
    async scrapeWithPlaywrightService(url, options) {
        logger_1.logger.info(`Scraping with enhanced PlaywrightService: ${url}`);
        const startTime = Date.now();
        try {
            // Convert ScraperOptions to PlaywrightOptions
            const playwrightOptions = {
                waitTime: options.waitForTimeout,
                blockResources: options.blockResources,
                stealthMode: options.stealthMode,
                maxScrolls: options.maxScrolls,
                ignoreRobotsTxt: true, // We handle robots.txt separately
                referrer: options.headers?.['referer'],
                logRequests: false,
                userAgent: options.userAgent,
                viewport: { width: 1920, height: 1080 },
                // Rate limiting options
                minDelay: options.minDelay,
                maxDelay: options.maxDelay,
                maxRetries: options.maxRetries,
                backoffFactor: options.backoffFactor,
                rotateUserAgent: options.rotateUserAgent,
                // Proxy options
                proxy: options.proxy,
                proxyUsername: options.proxyUsername,
                proxyPassword: options.proxyPassword,
                proxyRotation: options.proxyRotation,
                proxyList: options.proxyList
            };
            // Crawl the page using our enhanced service
            const response = await this.playwrightService.crawlPage(url, playwrightOptions);
            // Convert the response to ScraperResponse format
            return {
                url: response.url,
                title: response.title ?? '',
                content: response.content,
                contentType: 'html',
                metadata: {
                    timestamp: new Date().toISOString(),
                    status: response.status,
                    headers: {},
                    loadTime: Date.now() - startTime,
                    usedBrowser: true,
                    usedRateLimiting: true
                }
            };
        }
        catch (error) {
            logger_1.logger.error(`Error in enhanced scraping: ${error instanceof Error ? error.message : String(error)}`);
            return {
                url,
                title: '',
                content: '',
                contentType: 'html',
                metadata: {
                    timestamp: new Date().toISOString(),
                    status: 0,
                    headers: {},
                    loadTime: Date.now() - startTime
                },
                error: `Enhanced scraping error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Setup resource blocking for ads and other resources
     */
    async setupResourceBlocking(page, blockAds, blockResources) {
        await page.route('**/*', (route) => {
            const request = route.request();
            const url = request.url();
            const resourceType = request.resourceType();
            // Block ad-serving domains
            if (blockAds && types_1.AD_SERVING_DOMAINS.some(domain => url.includes(domain))) {
                logger_1.logger.debug(`Blocking ad resource: ${url}`);
                return route.abort();
            }
            // Block various resource types if blockResources is enabled
            if (blockResources && ['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
                logger_1.logger.debug(`Blocking resource: ${resourceType} - ${url}`);
                return route.abort();
            }
            // Allow other requests
            return route.continue();
        });
    }
    /**
     * Perform random scrolling on the page to mimic human behavior
     */
    async performRandomScrolling(page) {
        const scrollPositions = [300, 600, 1000, 1500, 2000, 2500];
        for (const position of scrollPositions) {
            await page.evaluate((pos) => {
                window.scrollTo(0, pos);
            }, position);
            // Random wait between scrolls
            await page.waitForTimeout(500 + Math.random() * 1000);
        }
        // Scroll back up randomly
        await page.evaluate(() => {
            window.scrollTo(0, 1000);
        });
        await page.waitForTimeout(500 + Math.random() * 1000);
    }
    /**
     * Execute a click action
     */
    async executeClickAction(page, action) {
        if (action.selector) {
            await page.click(action.selector);
        }
    }
    /**
     * Execute a scroll action
     */
    async executeScrollAction(page, action) {
        const position = action.position ?? 0;
        await page.evaluate((pos) => {
            window.scrollTo(0, pos);
        }, position);
    }
    /**
     * Execute a wait action
     */
    async executeWaitAction(page, action) {
        const timeout = action.timeout ?? 1000;
        await page.waitForTimeout(timeout);
    }
    /**
     * Execute a fill action
     */
    async executeFillAction(page, action) {
        if (action.selector && action.value) {
            await page.fill(action.selector, action.value);
        }
    }
    /**
     * Execute a select action
     */
    async executeSelectAction(page, action) {
        if (action.selector && action.value) {
            await page.selectOption(action.selector, action.value);
        }
    }
    /**
     * Execute a single browser action based on its type
     */
    async executeSingleAction(page, action) {
        switch (action.type) {
            case 'click':
                await this.executeClickAction(page, action);
                break;
            case 'scroll':
                await this.executeScrollAction(page, action);
                break;
            case 'wait':
                await this.executeWaitAction(page, action);
                break;
            case 'fill':
                await this.executeFillAction(page, action);
                break;
            case 'select':
                await this.executeSelectAction(page, action);
                break;
        }
    }
    /**
     * Handle action execution with error handling
     */
    async executeActionSafely(page, action) {
        try {
            logger_1.logger.info(`Performing action: ${action.type} ${action.selector ?? ''}`);
            await this.executeSingleAction(page, action);
            await page.waitForTimeout(500); // Small delay between actions
        }
        catch (error) {
            if (action.optional) {
                logger_1.logger.warn(`Optional action failed: ${action.type} ${action.selector ?? ''} - ${error instanceof Error ? error.message : String(error)}`);
            }
            else {
                throw error;
            }
        }
    }
    /**
     * Execute a sequence of browser actions
     */
    async performActions(page, actions) {
        for (const action of actions) {
            await this.executeActionSafely(page, action);
        }
    }
    /**
     * Extract product data from Amazon using specific selectors
     */
    async extractAmazonProductData(page) {
        // Get the original HTML first as a fallback
        const originalHtml = await page.content();
        try {
            // Extract key product information using Amazon's specific selectors
            const productInfo = await page.evaluate(() => {
                // Common selectors for Amazon product pages
                const productTitle = document.querySelector('#productTitle')?.textContent?.trim() ?? '';
                const brand = document.querySelector('#bylineInfo')?.textContent?.trim() ?? '';
                const price = document.querySelector('.a-price .a-offscreen')?.textContent?.trim() ??
                    document.querySelector('#priceblock_ourprice')?.textContent?.trim() ??
                    document.querySelector('#corePrice_feature_div .a-price .a-offscreen')?.textContent?.trim() ?? '';
                const rating = document.querySelector('#acrPopover')?.getAttribute('title')?.trim() ??
                    document.querySelector('.a-icon-star')?.textContent?.trim() ?? '';
                // Technical specifications
                const techSpecs = {};
                const techSpecsTable = document.querySelector('.a-section.a-spacing-medium.a-spacing-top-small .a-section.a-spacing-small table') ??
                    document.querySelector('#productDetails_techSpec_section_1') ??
                    document.querySelector('#productDetails_detailBullets_sections1');
                if (techSpecsTable) {
                    const rows = techSpecsTable.querySelectorAll('tr');
                    rows.forEach(row => {
                        const key = row.querySelector('th')?.textContent?.trim() ?? '';
                        const value = row.querySelector('td')?.textContent?.trim() ?? '';
                        if (key && value) {
                            techSpecs[key] = value;
                        }
                    });
                }
                // Get bullet points for features
                const features = [];
                const featuresList = document.querySelector('#feature-bullets ul');
                if (featuresList) {
                    const items = featuresList.querySelectorAll('li');
                    items.forEach(item => {
                        const text = item.textContent?.trim();
                        if (text)
                            features.push(text);
                    });
                }
                // Enhanced content for product description
                const productDescription = document.querySelector('#productDescription')?.innerHTML ?? '';
                // Product details
                const detailBullets = document.querySelector('#detailBullets_feature_div');
                const detailBulletsContent = detailBullets ? detailBullets.innerHTML : '';
                // Compile all the data with HTML structure
                const enhancedHTML = `
          <div id="enhanced-product-data">
            <h1 id="productTitle">${productTitle}</h1>
            <div id="brandInfo">${brand}</div>
            <div id="priceSection">${price}</div>
            <div id="ratingSection">${rating}</div>
            
            <div id="technicalSpecifications">
              <h2>Technical Specifications</h2>
              <table>
                ${Object.entries(techSpecs).map(([key, value]) => `
                  <tr>
                    <th>${key}</th>
                    <td>${value}</td>
                  </tr>
                `).join('')}
              </table>
            </div>
            
            <div id="features">
              <h2>Features</h2>
              <ul>
                ${features.map(feature => `<li>${feature}</li>`).join('')}
              </ul>
            </div>
            
            <div id="productDescription">
              <h2>Product Description</h2>
              ${productDescription}
            </div>
            
            <div id="detailBullets">
              ${detailBulletsContent}
            </div>
          </div>
        `;
                return enhancedHTML;
            });
            // Combine the enhanced product info with the original HTML
            return `
        ${originalHtml}
        <!-- Enhanced Product Data -->
        ${productInfo}
      `;
        }
        catch (error) {
            logger_1.logger.warn(`Error extracting Amazon product data: ${error instanceof Error ? error.message : String(error)}`);
            // Return the original HTML if extraction fails
            return originalHtml;
        }
    }
}
exports.PlaywrightScraper = PlaywrightScraper;
