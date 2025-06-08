import axios, { AxiosError } from "axios";
import { load } from "cheerio";
import { URL } from "url";
import robotsParser, { Robot } from "robots-parser";
import https from "https";
import { logger } from "../utils/logger";
import { extractLinks } from "../utils/html-utils";
import { CrawlStrategy, CrawlerHooks, CrawlerOptions } from "../types/crawler";
import { PlaywrightService, PlaywrightOptions } from "../services/playwright.service";
import { UrlNormalizationService } from "../services/url-normalization.service";

export class WebCrawler {
  private jobId: string;
  private initialUrl: string;
  private baseUrl: string;
  private includes: string[];
  private excludes: string[];
  private maxCrawledLinks: number;
  private maxCrawledDepth: number;
  private visited: Set<string> = new Set();
  private crawledUrls: Map<string, string> = new Map();
  private lockedUrls: Set<string> = new Set();
  private redirectMapping: Map<string, string> = new Map();
  private deduplicateSimilarUrls: boolean = true;
  private limit: number;
  private robotsTxtUrl: string;
  public robots: Robot;
  private allowBackwardCrawling: boolean;
  private allowExternalContentLinks: boolean;
  private allowSubdomains: boolean;
  private ignoreRobotsTxt: boolean;
  private regexOnFullURL: boolean;
  private logger: typeof logger;
  private sitemapsHit: Set<string> = new Set();
  private maxDiscoveryDepth: number | undefined;
  private currentDiscoveryDepth: number;
  private strategy: CrawlStrategy;
  private hooks: CrawlerHooks;
  private urlQueue: string[] = [];
  private urlScores: Map<string, number> = new Map();
  private playwrightService: PlaywrightService | null = null;
  private useBrowser: boolean = false;
  private urlNormalizationService = UrlNormalizationService;

  constructor({
    jobId,
    initialUrl,
    baseUrl,
    includes,
    excludes,
    maxCrawledLinks = 10000,
    limit = 10000,
    maxCrawledDepth = 10,
    allowBackwardCrawling = false,
    allowExternalContentLinks = false,
    allowSubdomains = false,
    ignoreRobotsTxt = false,
    regexOnFullURL = false,
    strategy = CrawlStrategy.BFS,
    hooks = {},
    maxDiscoveryDepth,
    currentDiscoveryDepth,
    useBrowser = false,
    deduplicateSimilarUrls = true,
  }: CrawlerOptions) {
    this.jobId = jobId;
    this.initialUrl = initialUrl;
    this.baseUrl = baseUrl ?? new URL(initialUrl).origin;
    this.includes = Array.isArray(includes) ? includes : [];
    this.excludes = Array.isArray(excludes) ? excludes : [];
    this.limit = limit;
    this.robotsTxtUrl = `${this.baseUrl}${this.baseUrl.endsWith("/") ? "" : "/"}robots.txt`;
    this.robots = robotsParser(this.robotsTxtUrl, "");
    this.maxCrawledLinks = maxCrawledLinks ?? limit;
    this.maxCrawledDepth = maxCrawledDepth ?? 10;
    this.allowBackwardCrawling = allowBackwardCrawling ?? false;
    this.allowExternalContentLinks = allowExternalContentLinks ?? false;
    this.allowSubdomains = allowSubdomains ?? false;
    this.ignoreRobotsTxt = ignoreRobotsTxt ?? false;
    this.regexOnFullURL = regexOnFullURL ?? false;
    this.logger = logger;
    this.maxDiscoveryDepth = maxDiscoveryDepth;
    this.currentDiscoveryDepth = currentDiscoveryDepth ?? 0;
    this.strategy = strategy;
    this.hooks = hooks;
    this.useBrowser = useBrowser;
    this.deduplicateSimilarUrls = deduplicateSimilarUrls;

    // Initialize PlaywrightService if browser mode is enabled
    if (this.useBrowser) {
      this.playwrightService = new PlaywrightService();
      this.playwrightService.on('url-discovered', (data) => {
        logger.info(`Discovered URL: ${data.url} (Total: ${data.totalDiscovered})`);
      });
      this.playwrightService.on('url-crawled', (data) => {
        logger.info(`Crawled URL: ${data.url} (Total: ${data.totalCrawled})`);
      });
    }
  }

  /**
   * Check if link matches exclude patterns
   */
  private isExcludedByPatterns(link: string, path: string): boolean {
    if (this.excludes.length === 0 || this.excludes[0] === "") {
      return false;
    }

    const testPath = this.regexOnFullURL ? link : path;
    return this.excludes.some((excludePattern) =>
      new RegExp(excludePattern).test(testPath)
    );
  }

  /**
   * Check if link matches include patterns
   */
  private isIncludedByPatterns(link: string, path: string): boolean {
    if (this.includes.length === 0 || this.includes[0] === "") {
      return true;
    }

    const testPath = this.regexOnFullURL ? link : path;
    return this.includes.some((includePattern) =>
      new RegExp(includePattern).test(testPath)
    );
  }

  /**
   * Check backward crawling restrictions
   */
  private isBackwardCrawlingAllowed(normalizedLink: string): boolean {
    if (this.allowBackwardCrawling) {
      return true;
    }

    try {
      const normalizedInitialUrl = new URL(this.initialUrl);
      const normalizedLinkUrl = new URL(normalizedLink);
      return normalizedLinkUrl.pathname.startsWith(normalizedInitialUrl.pathname);
    } catch (_) {
      return false;
    }
  }

  /**
   * Check robots.txt allowance
   */
  private isAllowedByRobots(normalizedLink: string): boolean {
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
  private isLinkValid(link: string, maxDepth: number): boolean {
    let url: URL;
    try {
      url = new URL(link.trim(), this.baseUrl);
    } catch (error) {
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
    if (this.isExcludedByPatterns(normalizedLink, path)) return false;
    if (!this.isIncludedByPatterns(normalizedLink, path)) return false;

    // Check backward crawling
    if (!this.isBackwardCrawlingAllowed(normalizedLink)) return false;

    // Check robots.txt
    if (!this.isAllowedByRobots(normalizedLink)) return false;

    // Check if it's a file
    if (this.isFile(normalizedLink)) return false;

    return true;
  }

  public filterLinks(
    links: string[],
    limit: number,
    maxDepth: number,
    fromMap: boolean = false,
  ): string[] {
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

  private isFile(url: string): boolean {
    const fileExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip', '.rar', '.tar', '.gz', '.jpg', '.jpeg', '.png', '.gif',
      '.mp3', '.mp4', '.avi', '.mov', '.exe', '.apk', '.dmg', '.iso'
    ];
    
    try {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname.toLowerCase();
      return fileExtensions.some(ext => path.endsWith(ext));
    } catch (e) {
      return false;
    }
  }

  private getURLDepth(url: string): number {
    try {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname.endsWith('/') 
        ? parsedUrl.pathname.slice(0, -1) 
        : parsedUrl.pathname;
        
      if (path === '') return 0;
      return path.split('/').filter(Boolean).length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Lock a URL to prevent concurrent processing
   */
  private lockUrl(url: string): boolean {
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
  private unlockUrl(url: string): void {
    const normalizedUrl = this.urlNormalizationService.normalizeUrl(url);
    this.lockedUrls.delete(normalizedUrl);
  }

  /**
   * Check if URL has been visited or is similar to a visited URL
   */
  private isUrlVisited(url: string): boolean {
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
  private addRedirectMapping(fromUrl: string, toUrl: string): void {
    const normalizedFrom = this.urlNormalizationService.normalizeUrl(fromUrl);
    const normalizedTo = this.urlNormalizationService.normalizeUrl(toUrl);
    
    if (normalizedFrom !== normalizedTo) {
      this.redirectMapping.set(normalizedFrom, normalizedTo);
    }
  }

  public async getRobotsTxt(skipTlsVerification = false, abort?: AbortSignal): Promise<string> {
    let extraArgs = {};
    if (skipTlsVerification) {
      extraArgs = {
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        })
      };
    }
    try {
      const response = await axios.get(this.robotsTxtUrl, {
        timeout: 10000,
        signal: abort,
        ...extraArgs,
      });
      return response.data;
    } catch (error) {
      this.logger.debug(`Failed to get robots.txt from ${this.robotsTxtUrl}`, { error });
      return '';
    }
  }

  public importRobotsTxt(txt: string) {
    this.robots = robotsParser(this.robotsTxtUrl, txt);
  }

  public async extractLinksFromHtml(html: string, baseUrl: string): Promise<string[]> {
    try {
      const $ = load(html);
      const links: string[] = [];
      
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          try {
            const url = new URL(href, baseUrl);
            links.push(url.href);
          } catch (e) {
            // Invalid URL, ignore
          }
        }
      });
      
      return [...new Set(links)]; // Deduplicate links
    } catch (error) {
      this.logger.error('Error extracting links from HTML', { error });
      return [];
    }
  }

  /**
   * Execute before crawl hook
   */
  private async executeBeforeCrawlHook(normalizedUrl: string): Promise<void> {
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
  private async applyContentHooks(html: string, normalizedUrl: string): Promise<string> {
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
  private async executeErrorHook(error: Error, normalizedUrl: string): Promise<void> {
    if (this.hooks.onError) {
      await this.hooks.onError(error, normalizedUrl);
    }
  }

  /**
   * Configure Playwright options
   */
  private getPlaywrightOptions(): PlaywrightOptions {
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
  private async initializePlaywrightService(options: PlaywrightOptions): Promise<void> {
    if (!this.playwrightService) {
      this.playwrightService = new PlaywrightService();
      await this.playwrightService.initialize(options);
    }
  }

  /**
   * Crawl page using Playwright
   */
  private async crawlWithPlaywright(normalizedUrl: string): Promise<{html: string, links: string[]}> {
    try {
      const playwrightOptions = this.getPlaywrightOptions();
      await this.initializePlaywrightService(playwrightOptions);

      logger.info(`Crawling page with Playwright: ${normalizedUrl}`);
      const response = await this.playwrightService!.crawlPage(normalizedUrl, playwrightOptions);
      
      const html = await this.applyContentHooks(response.content, normalizedUrl);
      
      logger.info(`Crawled page with Playwright: ${normalizedUrl} - Found ${response.links.length} links`);
      return { html, links: response.links };
    } catch (error) {
      await this.executeErrorHook(error as Error, normalizedUrl);
      logger.error(`Error crawling ${normalizedUrl} with Playwright`, { error, url: normalizedUrl });
      return { html: '', links: [] };
    }
  }

  /**
   * Build Axios request configuration
   */
  private buildAxiosConfig(normalizedUrl: string, skipTlsVerification: boolean): any {
    const config: any = {
      timeout: 30000,
    };

    if (skipTlsVerification) {
      config.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    return config;
  }

  /**
   * Handle redirect mapping
   */
  private handleRedirect(response: any, normalizedUrl: string): void {
    if (response.request?.res?.responseUrl && response.request.res.responseUrl !== normalizedUrl) {
      this.addRedirectMapping(normalizedUrl, response.request.res.responseUrl);
    }
  }

  /**
   * Crawl page using Axios
   */
  private async crawlWithAxios(normalizedUrl: string, skipTlsVerification: boolean): Promise<{html: string, links: string[]}> {
    try {
      const config = this.buildAxiosConfig(normalizedUrl, skipTlsVerification);
      const response = await axios.get(normalizedUrl, config);
      
      this.handleRedirect(response, normalizedUrl);
      
      const html = await this.applyContentHooks(response.data, normalizedUrl);
      const links = await this.extractLinksFromHtml(html, normalizedUrl);
      
      return { html, links };
    } catch (error) {
      await this.executeErrorHook(error as Error, normalizedUrl);
      logger.error(`Error crawling ${normalizedUrl}`, { error, url: normalizedUrl });
      return { html: '', links: [] };
    }
  }

  /**
   * Check if URL can be crawled
   */
  private canCrawlUrl(normalizedUrl: string): boolean {
    if (this.isUrlVisited(normalizedUrl)) {
      return false;
    }
    
    if (!this.lockUrl(normalizedUrl)) {
      return false;
    }
    
    return true;
  }

  public async crawlPage(url: string, skipTlsVerification = false): Promise<{html: string, links: string[]}> {
    const normalizedUrl = this.urlNormalizationService.normalizeUrl(url);
    
    await this.executeBeforeCrawlHook(normalizedUrl);
    
    if (!this.canCrawlUrl(normalizedUrl)) {
      return { html: '', links: [] };
    }
    
    this.visited.add(normalizedUrl);
    
    try {
      if (this.useBrowser && this.playwrightService) {
        return await this.crawlWithPlaywright(normalizedUrl);
      } else {
        return await this.crawlWithAxios(normalizedUrl, skipTlsVerification);
      }
    } finally {
      this.unlockUrl(normalizedUrl);
    }
  }

  private addUrlsToQueue(urls: string[]): void {
    if (urls.length === 0) return;

    switch (this.strategy) {
      case CrawlStrategy.DFS:
        this.urlQueue.unshift(...urls);
        break;

      case CrawlStrategy.BEST_FIRST:
        urls.forEach(url => {
          if (!this.urlScores.has(url)) {
            const score = this.calculateUrlScore(url);
            this.urlScores.set(url, score);
          }
        });

        this.urlQueue.push(...urls);
        
        this.urlQueue.sort((a, b) => 
          (this.urlScores.get(b) || 0) - (this.urlScores.get(a) || 0)
        );
        break;

      case CrawlStrategy.BFS:
      default:
        this.urlQueue.push(...urls);
        break;
    }
  }

  private getNextUrl(): string | undefined {
    if (this.urlQueue.length === 0) return undefined;

    return this.urlQueue.shift();
  }

  private calculateUrlScore(url: string): number {
    try {
      const parsedUrl = new URL(url);
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
    } catch (e) {
      return -100;
    }
  }

  /**
   * Get the current crawling strategy
   * @returns The strategy name as a string
   */
  public getStrategy(): string {
    return this.strategy || 'bfs';
  }

  /**
   * Discover all URLs from a starting point using browser-based crawling
   * @param maxDepth Maximum depth to discover
   * @param limit Maximum number of URLs to discover
   * @returns Array of discovered URLs
   */
  public async discoverUrlsWithBrowser(maxDepth: number = 3, limit: number = 100): Promise<string[]> {
    if (!this.useBrowser) {
      logger.warn("Browser-based discovery called but browser mode is not enabled. Switching to browser mode.");
      this.useBrowser = true;
    }

    // Initialize PlaywrightService if not already initialized
    if (!this.playwrightService) {
      this.playwrightService = new PlaywrightService();
    }

    // Configure playwright options for discovery
    const playwrightOptions: PlaywrightOptions = {
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
      minDelay: 3000,         // Minimum 3 seconds between requests
      maxDelay: 30000,        // Maximum 30 seconds for backoff
      maxRetries: 3,          // Try up to 3 times
      backoffFactor: 2.0,     // Double the delay on each retry
      rotateUserAgent: true   // Rotate user agents for different requests
    };

    logger.info(`Starting browser-based URL discovery from ${this.initialUrl} with depth ${maxDepth} and limit ${limit}`);
    
    // Run the discovery phase
    const discoveredUrls = await this.playwrightService.discoveryPhase(this.initialUrl, playwrightOptions);
    
    logger.info(`Discovery completed. Found ${discoveredUrls.length} URLs`);
    
    return discoveredUrls;
  }

  /**
   * Close browser resources when done
   */
  public async close(): Promise<void> {
    if (this.playwrightService) {
      await this.playwrightService.close();
      this.playwrightService = null;
    }
  }
} 