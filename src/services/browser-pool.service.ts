import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { proxyService } from './proxy.service';
import { pickFingerprint, buildStealthInitScript } from '../scraper/stealth-hardening';

export interface BrowserPoolOptions {
  maxBrowsers?: number;          // Maximum number of browsers in pool
  maxContextsPerBrowser?: number; // Maximum contexts per browser
  idleTimeout?: number;          // Time to keep idle browsers (ms)
  launchOptions?: any;           // Playwright launch options
  enableResourceBlocking?: boolean;
  stealthMode?: boolean;
}

export interface PooledContext {
  context: BrowserContext;
  id: string;
  activePages: number;
  proxyServer?: string; // egress proxy this context routes through, if any
}

export interface PooledBrowser {
  browser: Browser;
  contexts: PooledContext[];
  activePages: number;
  createdAt: Date;
  lastUsed: Date;
  id: string;
}

export interface PoolStats {
  totalBrowsers: number;
  activeBrowsers: number;
  totalContexts: number;
  activePages: number;
  poolUtilization: number;
}

/**
 * Browser Pool Service - Manages reusable browser instances for optimal performance
 *
 * Benefits:
 * - 90% faster page loading (reuse vs new browser creation)
 * - Memory efficient (controlled browser lifecycle)
 * - Automatic cleanup of idle browsers
 * - Context isolation for parallel processing
 */
export class BrowserPoolService extends EventEmitter {
  private static instance: BrowserPoolService;
  private readonly browsers: Map<string, PooledBrowser> = new Map();
  private availableBrowsers: string[] = [];
  private readonly options: Required<BrowserPoolOptions>;
  private cleanupInterval?: NodeJS.Timeout;
  private isShuttingDown = false;
  private readonly beingRemoved: Set<string> = new Set(); // Track browsers being removed to prevent race conditions

  // Concurrency semaphore: caps total simultaneously-open pages at
  // maxBrowsers * maxContextsPerBrowser so a burst of requests can't launch an
  // unbounded number of Chromium processes (the classic OOM-after-hours cause).
  private activePageCount = 0;
  private readonly slotWaiters: Array<() => void> = [];

  private get maxPages(): number {
    return this.options.maxBrowsers * this.options.maxContextsPerBrowser;
  }

  /** Wait until a page slot is free, then reserve it. */
  private async acquireSlot(): Promise<void> {
    if (this.activePageCount < this.maxPages) {
      this.activePageCount++;
      return;
    }
    await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
    this.activePageCount++;
  }

  /** Release a page slot and wake the next waiter, if any. */
  private releaseSlot(): void {
    this.activePageCount = Math.max(0, this.activePageCount - 1);
    const next = this.slotWaiters.shift();
    if (next) next();
  }

  private constructor(options: BrowserPoolOptions = {}) {
    super();

    this.options = {
      // Default to modest sizes and allow env overrides so the pool's memory
      // footprint (each Chromium ≈ 150-300MB) can be tuned to the host/container.
      maxBrowsers: options.maxBrowsers ?? Number(process.env.MAX_BROWSERS ?? 3),
      maxContextsPerBrowser: options.maxContextsPerBrowser ?? Number(process.env.MAX_CONTEXTS_PER_BROWSER ?? 8),
      idleTimeout: options.idleTimeout ?? Number(process.env.BROWSER_IDLE_TIMEOUT_MS ?? 300000),
      launchOptions: options.launchOptions ?? {},
      enableResourceBlocking: options.enableResourceBlocking ?? true,
      stealthMode: options.stealthMode ?? true
    };

    this.startCleanupInterval();
    // Note: Process handlers are managed by main application to prevent conflicts

    logger.info('Browser pool initialized', {
      maxBrowsers: this.options.maxBrowsers,
      maxContextsPerBrowser: this.options.maxContextsPerBrowser,
      idleTimeout: this.options.idleTimeout
    });
  }

  /**
   * Get singleton instance of browser pool
   */
  static getInstance(options?: BrowserPoolOptions): BrowserPoolService {
    if (!BrowserPoolService.instance) {
      BrowserPoolService.instance = new BrowserPoolService(options);
    }
    return BrowserPoolService.instance;
  }

  /**
   * Dynamically resize the browser pool
   */
  async resizePool(newMaxBrowsers: number): Promise<void> {
    if (newMaxBrowsers < 1 || newMaxBrowsers > 15) {
      throw new Error('Browser pool size must be between 1 and 15');
    }

    const currentSize = this.browsers.size;
    const oldMaxBrowsers = this.options.maxBrowsers;

    logger.info('Resizing browser pool', {
      fromMaxBrowsers: oldMaxBrowsers,
      toMaxBrowsers: newMaxBrowsers,
      currentBrowsers: currentSize
    });

    // Update the max browsers limit
    this.options.maxBrowsers = newMaxBrowsers;

    // If we need to reduce the pool size, remove excess browsers
    if (currentSize > newMaxBrowsers) {
      const browsersToRemove = currentSize - newMaxBrowsers;
      const idleBrowsers = Array.from(this.browsers.values())
        .filter(b => b.activePages === 0)
        .sort((a, b) => a.lastUsed.getTime() - b.lastUsed.getTime());

      // Remove idle browsers first
      const toRemove = Math.min(browsersToRemove, idleBrowsers.length);
      for (let i = 0; i < toRemove; i++) {
        await this.removeBrowser(idleBrowsers[i].id);
      }

      logger.info('Browser pool resized (reduced)', {
        newMaxBrowsers,
        removedBrowsers: toRemove,
        currentBrowsers: this.browsers.size
      });
    } else {
      logger.info('Browser pool resized (increased)', {
        newMaxBrowsers,
        currentBrowsers: this.browsers.size
      });
    }

    this.emit('poolResized', { newMaxBrowsers, currentBrowsers: this.browsers.size });
  }

  /**
   * Get a page from the browser pool (main method for consumers)
   */
  async getPage(): Promise<{ page: Page; browserId: string; contextId: string }> {
    if (this.isShuttingDown) {
      throw new Error('Browser pool is shutting down');
    }

    // Block here until a page slot frees up — this is the hard concurrency cap.
    await this.acquireSlot();
    try {
      const browser = await this.pickOrCreateBrowser();

      const pooledContext = await this.getOrCreateContext(browser);
      const page = await pooledContext.context.newPage();

      // Configure page for optimal performance
      await this.configurePage(page);

      browser.activePages++;
      pooledContext.activePages++;
      browser.lastUsed = new Date();

      logger.debug('Page acquired from browser pool', {
        browserId: browser.id,
        contextId: pooledContext.id,
        activePages: browser.activePages,
        totalBrowsers: this.browsers.size,
        activePageCount: this.activePageCount
      });

      this.emit('pageAcquired', { browserId: browser.id, activePages: browser.activePages });

      return { page, browserId: browser.id, contextId: pooledContext.id };
    } catch (err) {
      // Failed to actually open the page — give the slot back so we don't leak it.
      this.releaseSlot();
      throw err;
    }
  }

  /**
   * Choose a connected browser with spare context capacity (least-loaded first),
   * or create a new one if we're under maxBrowsers. Because getPage() holds a
   * semaphore slot, we can never be asked for more pages than the pool can hold.
   */
  private async pickOrCreateBrowser(): Promise<PooledBrowser> {
    const candidates = Array.from(this.browsers.values())
      .filter(b => !this.beingRemoved.has(b.id) && b.browser.isConnected() && b.contexts.length < this.options.maxContextsPerBrowser)
      .sort((a, b) => a.activePages - b.activePages);

    if (candidates.length > 0) {
      return candidates[0];
    }
    if (this.browsers.size < this.options.maxBrowsers) {
      return this.createBrowser();
    }
    // All browsers are at context capacity but a page slot was granted — reuse
    // the least-loaded connected browser (it will get a fresh context/page).
    const anyConnected = Array.from(this.browsers.values())
      .filter(b => b.browser.isConnected())
      .sort((a, b) => a.activePages - b.activePages)[0];
    return anyConnected ?? this.createBrowser();
  }

  /**
   * Release a page back to the pool
   */
  async releasePage(
    page: Page,
    browserId: string,
    contextId?: string,
    closeContext: boolean = false
  ): Promise<void> {
    try {
      const browser = this.browsers.get(browserId);
      if (!browser) {
        logger.warn('Attempting to release page from unknown browser', { browserId });
        await page.close().catch(() => {});
        return;
      }

      // Close the page (never let a failure here skip the accounting below).
      try {
        if (!page.isClosed()) {
          await page.close();
        }
      } catch (closeErr) {
        logger.debug(`Page close failed (browser likely crashed): ${(closeErr as Error).message}`);
      }

      browser.activePages = Math.max(0, browser.activePages - 1);
      browser.lastUsed = new Date();

      // Close context if requested and no other pages are using it
      if (closeContext && contextId) {
        const pooledContext = browser.contexts.find(ctx => ctx.id === contextId);
        if (pooledContext) {
          pooledContext.activePages = Math.max(0, pooledContext.activePages - 1);
          const pages = pooledContext.context.pages();
          if (pages.length === 0) {
            await pooledContext.context.close().catch(() => {});
            browser.contexts = browser.contexts.filter(ctx => ctx.id !== contextId);
          }
        }
      }

      // A crashed/disconnected browser must be evicted, not returned to the pool.
      if (!browser.browser.isConnected()) {
        await this.removeBrowser(browserId);
      } else if (browser.activePages === 0 && !this.availableBrowsers.includes(browserId)) {
        this.availableBrowsers.push(browserId);
      }

      logger.debug('Page released to browser pool', {
        browserId,
        activePages: browser.activePages,
        availableBrowsers: this.availableBrowsers.length
      });

      this.emit('pageReleased', { browserId, activePages: browser.activePages });

    } catch (error) {
      logger.error('Error releasing page to browser pool', {
        browserId,
        error: (error as Error).message
      });
    } finally {
      // Always give the page slot back, even if cleanup above threw — otherwise
      // the semaphore leaks and the pool eventually deadlocks.
      this.releaseSlot();
    }
  }

  /**
   * Get browser pool statistics
   */
  getStats(): PoolStats {
    const totalBrowsers = this.browsers.size;
    const activeBrowsers = Array.from(this.browsers.values())
      .filter(b => b.activePages > 0).length;
    const totalContexts = Array.from(this.browsers.values())
      .reduce((sum, b) => sum + b.contexts.length, 0);
    const activePages = Array.from(this.browsers.values())
      .reduce((sum, b) => sum + b.activePages, 0);

    return {
      totalBrowsers,
      activeBrowsers,
      totalContexts,
      activePages,
      poolUtilization: totalBrowsers > 0 ? (activePages / (totalBrowsers * this.options.maxContextsPerBrowser)) : 0
    };
  }

  /**
   * Get an available browser or null if none available
   */
  private async getAvailableBrowser(): Promise<PooledBrowser | null> {
    if (this.availableBrowsers.length === 0) {
      return null;
    }

    const browserId = this.availableBrowsers.shift()!;
    const browser = this.browsers.get(browserId);

    if (!browser) {
      logger.warn('Browser not found in pool', { browserId });
      return null;
    }

    // Check if browser is still connected
    if (!browser.browser.isConnected()) {
      logger.warn('Browser disconnected, removing from pool', { browserId });
      await this.removeBrowser(browserId);
      return null;
    }

    return browser;
  }

  /**
   * Create a new browser instance
   */
  private async createBrowser(): Promise<PooledBrowser> {
    if (this.browsers.size >= this.options.maxBrowsers) {
      // Remove oldest idle browser to make room
      await this.removeOldestIdleBrowser();
    }

    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--metrics-recording-only',
        '--disable-component-extensions-with-background-pages',
        ...(this.options.stealthMode ? [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ] : [])
      ],
      ...this.options.launchOptions
    };

    const browser = await chromium.launch(launchOptions);
    const browserId = `browser-${randomBytes(9).toString('hex')}`;

    const pooledBrowser: PooledBrowser = {
      browser,
      contexts: [],
      activePages: 0,
      createdAt: new Date(),
      lastUsed: new Date(),
      id: browserId
    };

    // Evict immediately if Chromium crashes/disconnects, so dead entries don't
    // accumulate and force needless new launches.
    browser.on('disconnected', () => {
      if (!this.beingRemoved.has(browserId)) {
        this.browsers.delete(browserId);
        this.availableBrowsers = this.availableBrowsers.filter(id => id !== browserId);
        logger.warn('Browser disconnected — evicted from pool', { browserId });
      }
    });

    this.browsers.set(browserId, pooledBrowser);

    logger.info('New browser created in pool', {
      browserId,
      totalBrowsers: this.browsers.size,
      maxBrowsers: this.options.maxBrowsers
    });

    this.emit('browserCreated', { browserId, totalBrowsers: this.browsers.size });

    return pooledBrowser;
  }

  /**
   * Get or create a browser context
   */
  private async getOrCreateContext(browser: PooledBrowser): Promise<PooledContext> {
    // Reuse existing context if under limit
    if (browser.contexts.length < this.options.maxContextsPerBrowser) {
      // Rotate egress proxies across new contexts when a pool is configured. This
      // distributes traffic and composes with the SSRF pre-flight (the browser
      // still only navigates to targets the manager already vetted).
      const proxy = proxyService.next();
      // Fingerprint hygiene: use one internally-consistent profile per context so
      // UA/platform/locale/timezone/WebGL all agree, then patch automation leaks.
      const fp = this.options.stealthMode ? pickFingerprint() : null;
      const context = await browser.browser.newContext({
        viewport: fp ? fp.viewport : { width: 1920, height: 1080 },
        userAgent: fp ? fp.userAgent : this.getRandomUserAgent(),
        ...(fp ? { locale: fp.locale, timezoneId: fp.timezoneId, extraHTTPHeaders: { 'Accept-Language': `${fp.locale},en;q=0.9` } } : {}),
        ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {})
      });

      // Patch automation leaks (webdriver/chrome/plugins/WebGL) to match the profile.
      if (fp) {
        await context.addInitScript(buildStealthInitScript(fp));
      }

      // Configure context for performance
      if (this.options.enableResourceBlocking) {
        await this.setupResourceBlocking(context);
      }

      const pooledContext: PooledContext = {
        context,
        id: `ctx-${Date.now()}-${randomBytes(4).toString('hex')}`,
        activePages: 0,
        proxyServer: proxy?.server
      };

      browser.contexts.push(pooledContext);
      return pooledContext;
    }

    // Reuse context with least active pages
    return browser.contexts.reduce((min, ctx) =>
      ctx.activePages < min.activePages ? ctx : min,
      browser.contexts[0]
    );
  }

  /**
   * Configure page for optimal performance
   */
  private async configurePage(page: Page): Promise<void> {
    // Set timeouts
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Block unnecessary resources for better performance
    if (this.options.enableResourceBlocking) {
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }

    // Stealth/fingerprint hygiene is applied once at the context level
    // (see getOrCreateContext -> buildStealthInitScript), so nothing to do per-page.
  }

  /**
   * Setup resource blocking for a context
   */
  private async setupResourceBlocking(context: BrowserContext): Promise<void> {
    await context.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();

      // Block ads and analytics
      const blockPatterns = [
        'google-analytics.com',
        'googletagmanager.com',
        'doubleclick.net',
        'facebook.com/tr',
        'linkedin.com/li.lms'
      ];

      if (blockPatterns.some(pattern => url.includes(pattern))) {
        route.abort();
      } else if (['image', 'font', 'media'].includes(resourceType)) {
        // Block media for faster loading
        route.abort();
      } else {
        route.continue();
      }
    });
  }

  /**
   * Get random user agent
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    const randomIndex = randomBytes(1)[0] % userAgents.length;
    return userAgents[randomIndex];
  }

  /**
   * Remove oldest idle browser
   */
  private async removeOldestIdleBrowser(): Promise<void> {
    const idleBrowsers = Array.from(this.browsers.values())
      .filter(b => b.activePages === 0)
      .sort((a, b) => a.lastUsed.getTime() - b.lastUsed.getTime());

    if (idleBrowsers.length > 0) {
      await this.removeBrowser(idleBrowsers[0].id);
    }
  }

  /**
   * Remove a browser from the pool
   */
  private async removeBrowser(browserId: string): Promise<void> {
    // Prevent race conditions - check if already being removed
    if (this.beingRemoved.has(browserId)) {
      logger.debug('Browser already being removed, skipping', { browserId });
      return;
    }

    const browser = this.browsers.get(browserId);
    if (!browser) {
      logger.debug('Browser not found in pool, skipping removal', { browserId });
      return;
    }

    // Mark as being removed to prevent concurrent removal attempts
    this.beingRemoved.add(browserId);

    try {
      // Remove from available list immediately
      this.availableBrowsers = this.availableBrowsers.filter(id => id !== browserId);

      // Close all contexts safely
      const contextClosePromises = browser.contexts.map(async (ctx) => {
        try {
          await ctx.context.close();
        } catch (error) {
          logger.debug('Error closing context (may already be closed)', {
            browserId,
            contextId: ctx.id,
            error: (error as Error).message
          });
        }
      });

      await Promise.allSettled(contextClosePromises);

      // Close browser safely
      try {
        if (browser.browser.isConnected()) {
          await browser.browser.close();
        }
      } catch (error) {
        logger.debug('Error closing browser (may already be closed)', {
          browserId,
          error: (error as Error).message
        });
      }

      // Remove from pool
      this.browsers.delete(browserId);

      logger.info('Browser removed from pool', {
        browserId,
        totalBrowsers: this.browsers.size
      });

      this.emit('browserRemoved', { browserId, totalBrowsers: this.browsers.size });

    } catch (error) {
      logger.error('Error removing browser from pool', {
        browserId,
        error: (error as Error).message,
        stack: (error as Error).stack
      });
    } finally {
      // Always remove from tracking set
      this.beingRemoved.delete(browserId);
    }
  }

  /**
   * Cleanup idle browsers
   */
  private async cleanupIdleBrowsers(): Promise<void> {
    const now = Date.now();
    const idleBrowsers = Array.from(this.browsers.values())
      .filter(b =>
        b.activePages === 0 &&
        (now - b.lastUsed.getTime()) > this.options.idleTimeout
      );

    for (const browser of idleBrowsers) {
      await this.removeBrowser(browser.id);
    }

    if (idleBrowsers.length > 0) {
      logger.debug('Cleaned up idle browsers', {
        removedCount: idleBrowsers.length,
        remainingBrowsers: this.browsers.size
      });
    }
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupIdleBrowsers();
    }, 60000); // Run every minute
  }

  /**
   * Setup process handlers for graceful shutdown
   */
  // Process handlers removed to prevent conflicts with main application shutdown handling

  /**
   * Shutdown browser pool gracefully
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info('Shutting down browser pool...');

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all browsers
    const browserIds = Array.from(this.browsers.keys());
    await Promise.all(browserIds.map(id => this.removeBrowser(id)));

    logger.info('Browser pool shutdown complete');
    this.emit('shutdown');
  }
}

// Export singleton instance
export const browserPool = BrowserPoolService.getInstance();
