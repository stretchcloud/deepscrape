import { chromium, Browser, Page, Route, Request } from 'playwright';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { ScraperOptions, BrowserAction, ScraperResponse } from '../types';
import { AD_SERVING_DOMAINS } from '../types';
import { PlaywrightService, PlaywrightOptions } from '../services/playwright.service';

/**
 * Browser-based scraper using Playwright
 */
export class PlaywrightScraper {
  private playwrightService: PlaywrightService;

  constructor() {
    this.playwrightService = new PlaywrightService();
  }

  /**
   * Scrape a URL using Playwright
   */
  async scrape(url: string, options: ScraperOptions = {}): Promise<ScraperResponse> {
    const startTime = Date.now();
    
    try {
      // Check if we're using the enhanced browser-based approach
      if (options.useBrowser) {
        return await this.scrapeWithPlaywrightService(url, options);
      }
      
      // Original implementation for backward compatibility
      let browser: Browser | null = null;
      let page: Page | null = null;
      
      try {
        // Set default options
        const timeout = options.timeout || 30000;
        const blockAds = options.blockAds !== false;
        const blockResources = options.blockResources !== false;
        const userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        
        // Check if the URL is from Amazon or other e-commerce sites that need special handling
        const isAmazon = url.includes('amazon.com') || url.includes('amazon.');
        const isEcommerce = isAmazon || url.includes('walmart.com') || url.includes('bestbuy.com');
        
        // Launch browser
        logger.info(`Launching browser with options: ${JSON.stringify(options.puppeteerLaunchOptions || {})}`);
        
        const launchOptions: any = {
          headless: true,
          // Use system chromium in Docker/Alpine
          executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
        
        // Use non-headless mode for e-commerce sites to bypass bot detection
        if (isEcommerce) {
          logger.info('E-commerce site detected, using enhanced anti-bot measures');
          launchOptions.headless = false;
        }
        
        // Force use of system chromium in Docker
        if (process.env.NODE_ENV === 'production' || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
          launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
        }
        
        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
          userAgent,
          viewport: { width: 1920, height: 1080 },
          ignoreHTTPSErrors: true
        });
        
        // Add special handling for Amazon and other e-commerce sites
        if (isEcommerce) {
          // Set cookies to appear more like a regular user
          const timestamp = Date.now();
          const sessionId = `${timestamp.toString(36)}-${randomBytes(8).toString('hex')}`;
          const ubidValue = `${timestamp.toString(36)}-${randomBytes(12).toString('hex')}`;
          
          await context.addCookies([
            { name: 'session-id', value: sessionId, domain: '.amazon.com', path: '/' },
            { name: 'ubid-main', value: ubidValue, domain: '.amazon.com', path: '/' }
          ]);
          
          // Add extra headers to appear more like a regular browser
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
        
        // Create new page
        page = await context.newPage();
        
        // Block ads and unnecessary resources if requested
        if (blockAds || blockResources) {
          await this.setupResourceBlocking(page, blockAds, blockResources);
        }
        
        // Set custom headers if provided
        if (options.headers) {
          await page.setExtraHTTPHeaders(options.headers);
        }
        
        // Navigate to URL with timeout
        logger.info(`Navigating to URL: ${url}`);
        
        // For Amazon, use a randomized approach to loading the page
        if (isAmazon) {
          // First go to the Amazon homepage to establish a session
          await page.goto('https://www.amazon.com', { timeout, waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2000 + Math.random() * 1000);
          
          // Then go to the product page
          await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
        } else {
          await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
        }
        
        // Wait for specific selector if provided
        if (options.waitForSelector) {
          logger.info(`Waiting for selector: ${options.waitForSelector}`);
          try {
            await page.waitForSelector(options.waitForSelector, { timeout });
          } catch (error) {
            logger.warn(`Timeout waiting for selector: ${options.waitForSelector}`);
            // Continue anyway, as the content might still be usable
          }
        }
        
        // For Amazon, add random scrolling behavior to mimic human browsing
        if (isAmazon) {
          logger.info('Performing random scrolling for Amazon page');
          await this.performRandomScrolling(page);
        }
        
        // Wait additional time if specified
        const waitTime = options.waitForTimeout !== undefined ? options.waitForTimeout : 0;
        if (waitTime > 0) {
          logger.info(`Waiting additional ${waitTime}ms`);
          await page.waitForTimeout(waitTime);
        }
        
        // Execute actions if provided
        if (options.actions && options.actions.length > 0) {
          logger.info(`Executing ${options.actions.length} actions`);
          await this.performActions(page, options.actions);
        }
        
        // Get page metadata
        const title = await page.title();
        // Safer way to get response info
        let status = 0;
        let headers: Record<string, string> = {};
        try {
          const responseInfo = await page.evaluate(() => {
            const perf = window.performance.getEntriesByType('navigation')[0] as any;
            return { 
              status: perf?.responseStatus || 0,
              headers: {} // Headers not easily accessible from client side
            };
          });
          status = responseInfo.status;
        } catch (error) {
          logger.warn(`Could not get response info: ${error}`);
        }
        
        // For Amazon, get the product data using a more specific approach
        let content = '';
        if (isAmazon) {
          content = await this.extractAmazonProductData(page);
        } else {
          // Get full HTML content
          content = await page.content();
        }
        
        // Take screenshot if requested
        let screenshot;
        if (options.fullPage) {
          screenshot = await page.screenshot({ fullPage: true, type: 'png' });
        }
        
        const loadTime = Date.now() - startTime;
        logger.info(`Page loaded in ${loadTime}ms`);
        
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
      } finally {
        // Close browser
        if (browser) {
          logger.info('Closing browser');
          await browser.close();
        }
      }
    } catch (error) {
      logger.error(`Error scraping URL: ${error instanceof Error ? error.message : String(error)}`);
      
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
  }

  /**
   * Scrape URL using the enhanced PlaywrightService with rate limiting and stealth
   */
  private async scrapeWithPlaywrightService(url: string, options: ScraperOptions): Promise<ScraperResponse> {
    logger.info(`Scraping with enhanced PlaywrightService: ${url}`);
    const startTime = Date.now();
    
    try {
      // Convert ScraperOptions to PlaywrightOptions
      const playwrightOptions: PlaywrightOptions = {
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
        title: response.title || '',
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
    } catch (error) {
      logger.error(`Error in enhanced scraping: ${error instanceof Error ? error.message : String(error)}`);
      
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
  private async setupResourceBlocking(page: Page, blockAds: boolean, blockResources: boolean): Promise<void> {
    await page.route('**/*', (route) => {
      const request = route.request();
      const url = request.url();
      const resourceType = request.resourceType();
      
      // Block ad-serving domains
      if (blockAds && AD_SERVING_DOMAINS.some(domain => url.includes(domain))) {
        logger.debug(`Blocking ad resource: ${url}`);
        return route.abort();
      }
      
      // Block various resource types if blockResources is enabled
      if (blockResources && ['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
        logger.debug(`Blocking resource: ${resourceType} - ${url}`);
        return route.abort();
      }
      
      // Allow other requests
      return route.continue();
    });
  }

  /**
   * Perform random scrolling on the page to mimic human behavior
   */
  private async performRandomScrolling(page: Page): Promise<void> {
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
   * Execute a sequence of browser actions
   */
  private async performActions(page: Page, actions: BrowserAction[]): Promise<void> {
    for (const action of actions) {
      try {
        logger.info(`Performing action: ${action.type} ${action.selector || ''}`);
        
        switch (action.type) {
          case 'click':
            if (action.selector) {
              await page.click(action.selector);
            }
            break;
            
          case 'scroll':
            const position = action.position || 0;
            await page.evaluate((pos) => {
              window.scrollTo(0, pos);
            }, position);
            break;
            
          case 'wait':
            const timeout = action.timeout || 1000;
            await page.waitForTimeout(timeout);
            break;
            
          case 'fill':
            if (action.selector && action.value) {
              await page.fill(action.selector, action.value);
            }
            break;
            
          case 'select':
            if (action.selector && action.value) {
              await page.selectOption(action.selector, action.value);
            }
            break;
        }
        
        // Add a small delay between actions
        await page.waitForTimeout(500);
      } catch (error) {
        // If action is optional, continue with other actions
        if (action.optional) {
          logger.warn(`Optional action failed: ${action.type} ${action.selector || ''} - ${error instanceof Error ? error.message : String(error)}`);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Extract product data from Amazon using specific selectors
   */
  private async extractAmazonProductData(page: Page): Promise<string> {
    // Get the original HTML first as a fallback
    const originalHtml = await page.content();
    
    try {
      // Extract key product information using Amazon's specific selectors
      const productInfo = await page.evaluate(() => {
        // Common selectors for Amazon product pages
        const productTitle = document.querySelector('#productTitle')?.textContent?.trim() || '';
        const brand = document.querySelector('#bylineInfo')?.textContent?.trim() || '';
        const price = document.querySelector('.a-price .a-offscreen')?.textContent?.trim() || 
                     document.querySelector('#priceblock_ourprice')?.textContent?.trim() || 
                     document.querySelector('#corePrice_feature_div .a-price .a-offscreen')?.textContent?.trim() || '';
        
        const rating = document.querySelector('#acrPopover')?.getAttribute('title')?.trim() || 
                      document.querySelector('.a-icon-star')?.textContent?.trim() || '';
        
        // Technical specifications
        const techSpecs: Record<string, string> = {};
        const techSpecsTable = document.querySelector('.a-section.a-spacing-medium.a-spacing-top-small .a-section.a-spacing-small table') || 
                               document.querySelector('#productDetails_techSpec_section_1') ||
                               document.querySelector('#productDetails_detailBullets_sections1');
        
        if (techSpecsTable) {
          const rows = techSpecsTable.querySelectorAll('tr');
          rows.forEach(row => {
            const key = row.querySelector('th')?.textContent?.trim() || '';
            const value = row.querySelector('td')?.textContent?.trim() || '';
            if (key && value) {
              techSpecs[key] = value;
            }
          });
        }
        
        // Get bullet points for features
        const features: string[] = [];
        const featuresList = document.querySelector('#feature-bullets ul');
        if (featuresList) {
          const items = featuresList.querySelectorAll('li');
          items.forEach(item => {
            const text = item.textContent?.trim();
            if (text) features.push(text);
          });
        }
        
        // Enhanced content for product description
        const productDescription = document.querySelector('#productDescription')?.innerHTML || '';
        
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
    } catch (error) {
      logger.warn(`Error extracting Amazon product data: ${error instanceof Error ? error.message : String(error)}`);
      // Return the original HTML if extraction fails
      return originalHtml;
    }
  }
} 