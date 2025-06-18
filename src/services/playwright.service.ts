import { chromium, Browser, BrowserContext, Page, Route, Request } from 'playwright';
import { logger } from '../utils/logger';
import UserAgent from 'user-agents';
import { EventEmitter } from 'events';

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

// Interfaces
export interface PlaywrightResponse {
  content: string;
  links: string[];
  url: string;
  title?: string;
  status: number;
}

export interface PlaywrightOptions {
  waitTime?: number;
  blockResources?: boolean;
  stealthMode?: boolean;
  maxScrolls?: number;
  ignoreRobotsTxt?: boolean;
  referrer?: string;
  logRequests?: boolean;
  userAgent?: string;
  viewport?: { width: number; height: number };
  discoverLinks?: boolean;
  maxDiscoveryDepth?: number;
  discoveryLimit?: number;
  includePaths?: string[];
  excludePaths?: string[];
  excludeDomains?: string[];
  baseUrl?: string;
  // Rate limiting options
  minDelay?: number;
  maxDelay?: number;
  maxRetries?: number;
  backoffFactor?: number;
  rotateUserAgent?: boolean;
  // Proxy options
  proxy?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  proxyRotation?: boolean;
  proxyList?: string[];
}

// Extend Window interface to include our custom properties
declare global {
  interface Window {
    _originalNavigator?: any;
    _originalWebGL?: any;
    _originalWebGL2?: any;
  }
}

// Main service class
export class PlaywrightService extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private discoveredUrls: Set<string> = new Set();
  private crawledUrls: Set<string> = new Set();
  private urlsToVisit: string[] = [];
  private urlsInProgress: Set<string> = new Set();
  private totalDiscovered = 0;
  private totalCrawled = 0;
  private lastRequestTime = 0;
  
  // Rate limiting configuration
  private rateLimit = {
    minDelay: 2000,      // Minimum delay between requests (ms)
    maxDelay: 15000,     // Maximum delay for backoff (ms)
    maxRetries: 3,       // Maximum number of retries
    backoffFactor: 1.5   // Exponential backoff multiplier
  };

  // User agent rotation options
  private userAgents: string[] = [];
  private currentUserAgentIndex = 0;

  // Add proxy rotation properties
  private proxyList: string[] = [];
  private currentProxyIndex = 0;

  constructor() {
    super();
    // Initialize a pool of different user agents for rotation
    this.initUserAgentPool();
  }

  /**
   * Initialize a pool of diverse user agents for rotation
   */
  private initUserAgentPool(): void {
    // Create a diverse pool of user agents
    const userAgentGenerator = new UserAgent();
    
    // Generate a pool of 10 different user agents
    for (let i = 0; i < 10; i++) {
      const agent = userAgentGenerator.toString();
      this.userAgents.push(agent);
    }
    
    logger.debug(`Initialized pool of ${this.userAgents.length} user agents for rotation`);
  }

  /**
   * Get the next user agent from the rotation pool
   */
  private getNextUserAgent(): string {
    const agent = this.userAgents[this.currentUserAgentIndex];
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
    return agent;
  }

  /**
   * Add proxies to the rotation list
   * @param proxies List of proxy URLs (e.g. "http://proxy.example.com:8080")
   */
  public addProxies(proxies: string[]): void {
    if (!proxies || proxies.length === 0) return;
    
    // Add proxies to our list
    this.proxyList.push(...proxies.filter(p => p && p.trim() !== ''));
    logger.info(`Added ${proxies.length} proxies to rotation pool. Total: ${this.proxyList.length}`);
  }

  /**
   * Get the next proxy from the rotation pool
   * @returns The next proxy URL or null if none available
   */
  private getNextProxy(): string | null {
    if (this.proxyList.length === 0) return null;
    
    const proxy = this.proxyList[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length;
    return proxy;
  }

  /**
   * Update rate limiting configuration from options
   */
  private updateRateLimitConfig(options: PlaywrightOptions): void {
    if (options.minDelay) this.rateLimit.minDelay = options.minDelay;
    if (options.maxDelay) this.rateLimit.maxDelay = options.maxDelay;
    if (options.maxRetries) this.rateLimit.maxRetries = options.maxRetries;
    if (options.backoffFactor) this.rateLimit.backoffFactor = options.backoffFactor;
  }

  /**
   * Add proxies if provided in options
   */
  private addProxiesIfProvided(options: PlaywrightOptions): void {
    if (options.proxyList && options.proxyList.length > 0) {
      this.addProxies(options.proxyList);
    }
  }

  /**
   * Launch browser with default options
   */
  private async launchBrowser(): Promise<Browser> {
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

    return await chromium.launch(launchOptions);
  }

  /**
   * Get user agent based on options
   */
  private getUserAgent(options: PlaywrightOptions): string {
    return options.userAgent || 
      (options.rotateUserAgent ? this.getNextUserAgent() : new UserAgent().toString());
  }

  /**
   * Build browser context options
   */
  private buildContextOptions(options: PlaywrightOptions, userAgent: string): any {
    const contextOptions: any = {
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
  private addProxyToContext(contextOptions: any, options: PlaywrightOptions): void {
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
      
      logger.info(`Using proxy: ${proxyUrl}`);
    }
  }

  /**
   * Setup context features like stealth mode and resource blocking
   */
  private async setupContextFeatures(options: PlaywrightOptions): Promise<void> {
    if (options.stealthMode) {
      await this._setupStealthMode(this.context!);
      logger.info('Stealth mode configured for browser context');
    }

    if (options.blockResources === true) {
      await this._setupResourceBlocking(this.context!, options.logRequests || false);
      logger.info('Resource blocking configured');
    }
  }

  /**
   * Apply rate limiting delay before making requests
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (this.lastRequestTime > 0 && timeSinceLastRequest < this.rateLimit.minDelay) {
      const waitTime = this.rateLimit.minDelay - timeSinceLastRequest;
      if (waitTime > 0) {
        logger.debug(`Rate limiting: Waiting ${waitTime}ms before next request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Handle retry delay with randomization
   */
  private async handleRetryDelay(retries: number, delay: number, url: string): Promise<void> {
    if (retries > 0) {
      const randomizedDelay = delay * (0.8 + Math.random() * 0.4);
      logger.info(`Retry ${retries}: Waiting ${Math.round(randomizedDelay)}ms before requesting ${url}`);
      await new Promise(resolve => setTimeout(resolve, randomizedDelay));
    }
  }

  /**
   * Check if error is rate limiting related
   */
  private isRateLimitError(error: any): boolean {
    return error.message.includes('429') || 
           error.message.includes('Too Many Requests') ||
           error.message.includes('too many requests');
  }

  /**
   * Handle rate limit retry logic
   */
  private async handleRateLimitRetry(
    url: string, 
    retries: number, 
    delay: number, 
    options: PlaywrightOptions
  ): Promise<{ shouldContinue: boolean; retries: number; delay: number }> {
    retries++;
    if (retries > this.rateLimit.maxRetries) {
      logger.error(`Rate limit exceeded for ${url} after ${retries} retries`);
      return { shouldContinue: false, retries, delay };
    }
    
    delay = Math.min(this.rateLimit.maxDelay, delay * this.rateLimit.backoffFactor);
    logger.warn(`Rate limited on ${url}, retry ${retries}/${this.rateLimit.maxRetries} after ${delay}ms backoff`);
    
    await this.rotateUserAgentAndProxy(options);
    
    return { shouldContinue: true, retries, delay };
  }

  /**
   * Rotate user agent and proxy if needed
   */
  private async rotateUserAgentAndProxy(options: PlaywrightOptions): Promise<void> {
    let needContextReinit = false;
    
    if (options.rotateUserAgent) {
      const newUserAgent = this.getNextUserAgent();
      logger.info(`Rotating user agent to: ${newUserAgent}`);
      options.userAgent = newUserAgent;
      needContextReinit = true;
    }
    
    if (options.proxyRotation && this.proxyList.length > 0) {
      const newProxy = this.getNextProxy();
      if (newProxy) {
        logger.info(`Rotating proxy to: ${newProxy}`);
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
  private async reinitializeContext(options: PlaywrightOptions): Promise<void> {
    if (!this.browser || !this.context) return;
    
    await this.context.close();
    
    const contextOptions = this.buildContextOptionsForRetry(options);
    this.context = await this.browser.newContext(contextOptions);
    
    await this.reapplyContextSettings(options);
  }

  /**
   * Build context options for retry attempts
   */
  private buildContextOptionsForRetry(options: PlaywrightOptions): any {
    const contextOptions: any = {
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
  private async reapplyContextSettings(options: PlaywrightOptions): Promise<void> {
    if (options.stealthMode) {
      await this._setupStealthMode(this.context!);
    }
    if (options.blockResources === true) {
      await this._setupResourceBlocking(this.context!, options.logRequests || false);
    }
  }

  /**
   * Ensure browser and context are initialized
   */
  private async ensureBrowserContext(options: PlaywrightOptions): Promise<void> {
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
  private async navigateWithRetry(page: Page, url: string): Promise<any> {
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
      } catch (error) {
        if (this.isTimeoutError(error)) {
          timeoutRetries++;
          
          if (timeoutRetries > maxTimeoutRetries) {
            throw error;
          }
          
          logger.warn(`Navigation timeout for ${url}, retrying (${timeoutRetries}/${maxTimeoutRetries})...`);
          response = await this.retryWithDifferentStrategy(page, url);
          if (response) break;
        } else {
          throw error;
        }
      }
    }

    return response;
  }

  /**
   * Check if error is a timeout error
   */
  private isTimeoutError(error: any): boolean {
    return error instanceof Error && error.message.includes('timeout');
  }

  /**
   * Retry navigation with different strategy
   */
  private async retryWithDifferentStrategy(page: Page, url: string): Promise<any> {
    try {
      const response = await page.goto(url, {
        waitUntil: 'load',
        timeout: 60000
      });
      logger.info(`Retry succeeded with 'load' strategy for ${url}`);
      return response;
    } catch (retryError) {
      if (this.isTimeoutError(retryError)) {
        logger.warn(`Retry failed with 'load' strategy for ${url}, trying again...`);
        return null;
      }
      throw retryError;
    }
  }

  /**
   * Handle error status codes
   */
  private handleErrorStatus(url: string, status: number): PlaywrightResponse {
    if (status === 429) {
      throw new Error(`Too Many Requests (429) for URL: ${url}`);
    }
    
    logger.warn(`Error status code: ${status} for URL: ${url}`);
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
  private async waitAndScroll(page: Page, options: PlaywrightOptions): Promise<void> {
    const waitTime = options.waitTime || 1000;
    await page.waitForTimeout(waitTime);
    logger.debug(`Waited for ${waitTime}ms after page load`);

    await this._simulateHumanScrolling(page, options.maxScrolls || 3);
  }

  /**
   * Extract page content, title, and links
   */
  private async extractPageData(page: Page): Promise<{ content: string; title: string; links: string[] }> {
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map(anchor => (anchor as HTMLAnchorElement).href)
        .filter(href => href && typeof href === 'string' && !href.startsWith('javascript:'))
        .map(href => {
          try {
            return new URL(href).toString();
          } catch {
            return null;
          }
        })
        .filter((url): url is string => url !== null);
    });

    logger.info(`Extracted ${links.length} links from page`);

    const content = await page.content();
    const title = await page.title();

    return { content, title, links };
  }

  /**
   * Initialize the browser and browser context with specified options
   * @param options The playwright options
   * @returns The initialized browser and context
   */
  public async initialize(options: PlaywrightOptions = {}): Promise<{ browser: Browser; context: BrowserContext }> {
    logger.info('Initializing Playwright browser...');

    this.updateRateLimitConfig(options);
    this.addProxiesIfProvided(options);

    this.browser = await this.launchBrowser();
    logger.info('Browser launched successfully');

    const userAgent = this.getUserAgent(options);
    const contextOptions = this.buildContextOptions(options, userAgent);
    
    this.context = await this.browser.newContext(contextOptions);
    logger.info(`Created browser context with user agent: ${userAgent}`);

    await this.setupContextFeatures(options);

    return { browser: this.browser, context: this.context };
  }

  /**
   * Crawl a specific URL and extract content with retry logic
   * @param url The URL to crawl
   * @param options The playwright options
   * @returns The crawl response with content, links, etc.
   */
  public async crawlPage(url: string, options: PlaywrightOptions = {}): Promise<PlaywrightResponse> {
    await this.applyRateLimit();
    
    let retries = 0;
    let delay = this.rateLimit.minDelay;
    let lastError: Error | null = null;
    
    while (retries <= this.rateLimit.maxRetries) {
      try {
        await this.handleRetryDelay(retries, delay, url);
        this.lastRequestTime = Date.now();
        
        return await this._performCrawl(url, options);
      } catch (error: any) {
        lastError = error as Error;
        logger.error(`Error crawling ${url}: ${(error as Error).message}`);
        
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
  private async _performCrawl(url: string, options: PlaywrightOptions = {}): Promise<PlaywrightResponse> {
    await this.ensureBrowserContext(options);
    
    logger.info(`Crawling page: ${url}`);
    const page = await this.context!.newPage();

    try {
      await this._addHumanBehavior(page);
      const response = await this.navigateWithRetry(page, url);
      const status = response?.status() || 200;
      
      logger.info(`Page loaded with status: ${status}`);
      
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
    } catch (error) {
      logger.error(`Error crawling ${url}: ${(error as Error).message}`);
      throw error;
    } finally {
      await page.close();
      logger.debug(`Page closed for URL: ${url}`);
    }
  }

  /**
   * Add randomized human-like behavior before page navigation
   * @param page The Playwright page
   */
  private async _addHumanBehavior(page: Page): Promise<void> {
    try {
      // Random mouse movements
      const viewport = page.viewportSize();
      if (viewport) {
        const { width, height } = viewport;
        
        // Move mouse to 2-4 random positions before navigation
        const movements = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < movements; i++) {
          const x = Math.floor(Math.random() * width);
          const y = Math.floor(Math.random() * (height / 2)); // Focus on upper half
          await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 20) });
          
          // Add random pause between movements
          await page.waitForTimeout(100 + Math.floor(Math.random() * 200));
        }
      }
    } catch (error) {
      // Don't fail if human behavior simulation fails
      logger.debug('Error simulating human behavior, continuing with navigation');
    }
  }

  /**
   * Simulate human-like scrolling behavior with random pauses
   * @param page The Playwright page
   * @param maxScrolls Maximum number of scroll actions
   */
  private async _simulateHumanScrolling(page: Page, maxScrolls: number): Promise<void> {
    try {
      logger.debug(`Performing human-like scrolling with ${maxScrolls} scrolls`);
      
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
          logger.debug('Reached bottom of page, stopping scroll simulation');
          break;
        }
        
        // Scroll a random amount (between 100px and viewport height)
        const scrollAmount = 100 + Math.floor(Math.random() * (clientHeight - 100));
        
        // Use a more human-like scroll with variable speed
        await page.evaluate((scrollAmount) => {
          return new Promise<void>((resolve) => {
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
        logger.debug(`Scrolled and waited ${pauseTime}ms`);
      }
    } catch (error) {
      // Don't fail if scrolling fails
      logger.debug('Error during human-like scrolling, continuing with extraction');
    }
  }

  /**
   * Run a discovery phase to find all URLs to crawl
   * @param startUrl The URL to start discovery from
   * @param options The playwright options
   * @returns The discovered URLs
   */
  public async discoveryPhase(startUrl: string, options: PlaywrightOptions = {}): Promise<string[]> {
    logger.info(`Starting discovery phase from: ${startUrl}`);
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
      logger.info(`Discovery phase - Depth: ${currentDepth + 1}/${maxDepth}, Discovered: ${this.totalDiscovered}, Crawled: ${this.totalCrawled}`);
      
      // Get the current level URLs
      const currentLevelUrls = [...this.urlsToVisit];
      this.urlsToVisit = [];

      // Process all URLs at the current level in parallel
      await Promise.all(
        currentLevelUrls.map(async (url) => {
          if (this.crawledUrls.size >= limit) return;
          if (this.crawledUrls.has(url) || this.urlsInProgress.has(url)) return;
          
          this.urlsInProgress.add(url);
          
          try {
            const response = await this.crawlPage(url, options);
            this.crawledUrls.add(url);
            this.totalCrawled++;
            
            // Filter and add new links
            const newLinks = response.links.filter(link => {
              if (!link) return false;
              
              try {
                const linkUrl = new URL(link);
                
                // Skip if not same origin
                if (linkUrl.origin !== new URL(baseUrl).origin) return false;
                
                // Skip if already discovered
                if (this.discoveredUrls.has(link)) return false;
                
                // Skip if in excluded domains
                if (excludeDomains.some(domain => linkUrl.hostname.includes(domain))) return false;
                
                // Check include paths
                const matchesIncludePath = includePaths.length === 0 || 
                  includePaths.some(pattern => new RegExp(pattern).test(linkUrl.pathname));
                
                // Check exclude paths
                const matchesExcludePath = excludePaths.length > 0 && 
                  excludePaths.some(pattern => new RegExp(pattern).test(linkUrl.pathname));
                
                return matchesIncludePath && !matchesExcludePath;
              } catch {
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
                
                if (this.totalDiscovered >= limit) break;
              }
            }
            
            // Emit crawled event
            this.emit('url-crawled', {
              url,
              totalCrawled: this.totalCrawled,
              newUrls: newLinks.length
            });
          } catch (error) {
            logger.error(`Error in discovery for ${url}: ${(error as Error).message}`);
          } finally {
            this.urlsInProgress.delete(url);
          }
        })
      );
      
      currentDepth++;
    }
    
    logger.info(`Discovery phase completed. Total discovered: ${this.totalDiscovered}, Total crawled: ${this.totalCrawled}`);
    return Array.from(this.discoveredUrls);
  }

  /**
   * Close the browser and context
   */
  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      logger.info('Browser closed successfully');
    }
  }

  /**
   * Set up stealth mode for browser context
   * @param context The browser context
   */
  private async _setupStealthMode(context: BrowserContext): Promise<void> {
    await context.addInitScript(function() {
      // Store original navigator and WebGL
      window._originalNavigator = window.navigator;
      window._originalWebGL = window.WebGLRenderingContext.prototype.getParameter;
      window._originalWebGL2 = window.WebGL2RenderingContext?.prototype.getParameter;
      
      // Override WebGL fingerprinting methods
      const getParameterProxyHandler = {
        apply: function(target: any, thisArg: any, args: any[]) {
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
        window.WebGLRenderingContext.prototype.getParameter = new Proxy(
          window.WebGLRenderingContext.prototype.getParameter,
          getParameterProxyHandler
        );
      }
      
      if (window.WebGL2RenderingContext) {
        window.WebGL2RenderingContext.prototype.getParameter = new Proxy(
          window.WebGL2RenderingContext.prototype.getParameter,
          getParameterProxyHandler
        );
      }
      
      // Mock permissions API to make it always return granted
      if (navigator.permissions) {
        navigator.permissions.query = async function(permissionDesc: any): Promise<PermissionStatus> {
          return Promise.resolve({
            state: "granted",
            onchange: null
          } as unknown as PermissionStatus);
        };
      }
      
      // Modify navigator properties to avoid detection
      const modifyNavigator = function() {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false
        });
        
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            // Create a plugins array that satisfies PluginArray interface
            const plugins = [] as unknown as PluginArray;
            
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
  private async _setupResourceBlocking(context: BrowserContext, logRequests: boolean): Promise<void> {
    // Block ad networks and unnecessary resources
    await context.route('**/*', (route: Route, request: Request) => {
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
      const microsoftNonEssential = isMicrosoftDocs && (
        url.includes('click') || 
        url.includes('feedback') || 
        url.includes('rating') ||
        url.includes('tracking') ||
        url.includes('telemetry') ||
        url.includes('analytics') ||
        url.includes('.gif') ||
        url.includes('.jpg') ||
        url.includes('.png') ||
        url.includes('.svg')
      );
      
      // Microsoft Docs specific - allow essential resources
      const isMicrosoftEssential = isMicrosoftDocs && (
        url.includes('main.js') ||
        url.includes('essential') ||
        url.includes('critical') ||
        url.includes('content') ||
        resourceType === 'document'
      );
      
      // Determine if request should be blocked
      const shouldBlock = 
        isAdDomain || 
        isTrackingResource || 
        microsoftNonEssential ||
        (blockResourceTypes.includes(resourceType) && !isMicrosoftEssential);
      
      if (shouldBlock) {
        if (logRequests) {
          logger.debug(`Blocked request: ${resourceType} - ${url}`);
        }
        route.abort();
      } else {
        route.continue();
      }
    });
  }
}

// Singleton instance
const playwrightService = new PlaywrightService();
export default playwrightService; 