import { SitemapParserService } from './sitemap-parser.service';
import { URLValidationUtils } from '../utils/url-validation.utils';
import { logger } from '../utils/logger';
import { redisClient } from './redis.service';
import { PlaywrightService } from './playwright.service';
import {
  DiscoveryOptions,
  DiscoveryResult,
  DiscoveryMethodResult,
  FilterOptions
} from '../types/discovery';
import {
  StreamingDiscoveryOptions,
  UrlStreamHandler,
  StreamingDiscoveryResult,
  StreamingMethodResult,
  UrlBatch
} from '../types/streaming-crawl';
import axios from 'axios';

/**
 * Multi-method URL discovery service inspired by an upstream project's /v1/map
 */
export class URLDiscoveryService {
  private readonly sitemapParser: SitemapParserService;
  private readonly playwrightService: PlaywrightService;
  private readonly cachePrefix = 'url-discovery';
  private readonly cacheDuration = 48 * 60 * 60; // 48 hours
  
  // Rate limiting configuration from environment variables
  private readonly config = {
    minDelay: parseInt(process.env.DISCOVERY_MIN_DELAY || '500'),
    maxConcurrency: parseInt(process.env.DISCOVERY_MAX_CONCURRENCY || '2'),
    sitemapDelay: parseInt(process.env.DISCOVERY_SITEMAP_DELAY || '300'),
    batchSize: parseInt(process.env.DISCOVERY_BATCH_SIZE || '3'),
    browserTimeout: parseInt(process.env.DISCOVERY_BROWSER_TIMEOUT || '10000')
  };

  constructor() {
    this.sitemapParser = new SitemapParserService();
    this.playwrightService = new PlaywrightService();
  }

  /**
   * Add delay to prevent rate limiting
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number, baseDelay: number = 1000): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay; // ±30% jitter
    return Math.min(exponentialDelay + jitter, 10000); // Cap at 10 seconds
  }

  /**
   * Execute request with exponential backoff retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Check if this is a rate limiting error
        const isRateLimit = lastError.message.includes('429') || 
                           lastError.message.toLowerCase().includes('rate limit') ||
                           lastError.message.toLowerCase().includes('too many requests');
        
        if (attempt === maxRetries || !isRateLimit) {
          break;
        }
        
        const backoffDelay = this.calculateBackoffDelay(attempt, baseDelay);
        logger.warn(`Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffDelay}ms`, {
          error: lastError.message,
          attempt: attempt + 1,
          delay: backoffDelay
        });
        
        await this.delay(backoffDelay);
      }
    }
    
    throw lastError || new Error('Operation failed with unknown error');
  }

  /**
   * Main URL discovery method - runs discovery methods in parallel
   */
  async discoverUrls(options: DiscoveryOptions): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const {
      url,
      maxUrls = 5000,
      includeSubdomains = true,
      searchQuery,
      skipSitemaps = false,
      sitemapsOnly = false,
      timeoutMs = 30000,
      includePatterns,
      excludePatterns,
      rateLimitingOptions = {},
      crawlOptions = {}
    } = options;

    // Merge user-provided rate limiting options with defaults
    const rateLimiting = {
      minDelay: rateLimitingOptions.minDelay ?? this.config.minDelay,
      maxConcurrency: rateLimitingOptions.maxConcurrency ?? this.config.maxConcurrency,
      sitemapDelay: rateLimitingOptions.sitemapDelay ?? this.config.sitemapDelay,
      batchSize: rateLimitingOptions.batchSize ?? this.config.batchSize,
      browserTimeout: rateLimitingOptions.browserTimeout ?? this.config.browserTimeout,
      enableRetry: rateLimitingOptions.enableRetry ?? true,
      maxRetries: rateLimitingOptions.maxRetries ?? 3
    };

    // Validate input
    if (!URLValidationUtils.isValidUrl(url)) {
      throw new Error('Invalid URL provided');
    }

    if (maxUrls > 30000) {
      throw new Error('maxUrls cannot exceed 30,000 URLs');
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(options);
    const cached = await this.getCachedResult(cacheKey);
    if (cached) {
      logger.info('Returning cached URL discovery result', { url, cacheKey });
      return cached;
    }

    // Set up abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Run discovery methods strategically: fast methods first, then supplement with crawling if needed
      const allUrls: string[] = [];
      const methodCounts = {
        sitemap: 0,
        search: 0,
        crawling: 0,
        commonPaths: 0,
        robotsSitemaps: 0,
        documents: 0
      };

      // Phase 1: Fast sitemap discovery (usually finds most URLs)
      const sitemapPromises: Promise<DiscoveryMethodResult>[] = [];
      
      if (!skipSitemaps) {
        sitemapPromises.push(this.runSitemapDiscovery(url, Math.floor(maxUrls * 0.6)));
        sitemapPromises.push(this.runRobotsSitemapDiscovery(url));
      }

      if (!sitemapsOnly) {
        sitemapPromises.push(this.runCommonPathsDiscovery(url, rateLimiting));
        sitemapPromises.push(this.runDocumentDiscovery(url, rateLimiting));
      }

      // Run fast discovery methods in parallel
      const sitemapResults = await Promise.allSettled(sitemapPromises);
      
      // Process sitemap results
      sitemapResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          const methodResult = result.value;
          allUrls.push(...methodResult.urls);
          methodCounts[methodResult.method] += methodResult.urls.length;
        }
      });

      // Phase 2: Browser crawling only if we haven't found enough URLs
      const currentUrlCount = allUrls.length;
      logger.info(`Fast discovery completed: ${currentUrlCount} URLs found`, {
        url,
        methods: methodCounts
      });

      if (!sitemapsOnly && currentUrlCount < maxUrls * 0.8) {
        logger.info('Running supplemental browser crawling', {
          url,
          currentUrls: currentUrlCount,
          targetUrls: maxUrls
        });
        
        const crawlResult = await this.runBrowserDiscovery(
          url, 
          Math.floor(maxUrls * 0.3), 
          rateLimiting, 
          {
            ...crawlOptions,
            maxCrawlDepth: Math.min(crawlOptions?.maxCrawlDepth || 2, 2), // Limit depth for speed
            enableDeepCrawling: currentUrlCount < maxUrls * 0.5 // Only deep crawl if we really need more URLs
          }
        );
        
        allUrls.push(...crawlResult.urls);
        methodCounts.crawling += crawlResult.urls.length;
      }


      // Filter and sort results
      const filterOptions: FilterOptions = {
        includeSubdomains,
        includePatterns,
        excludePatterns,
        searchQuery
      };

      const filteredUrls = URLValidationUtils.filterAndSortUrls(
        allUrls,
        url,
        { ...filterOptions, maxUrls }
      );

      const timeTaken = Date.now() - startTime;
      const discoveryResult: DiscoveryResult = {
        links: filteredUrls,
        total: filteredUrls.length,
        discoveryMethods: methodCounts,
        timeTaken,
        fromCache: false,
        searchQuery
      };

      // Cache the result
      await this.cacheResult(cacheKey, discoveryResult);

      logger.info('URL discovery completed', {
        url,
        totalUrls: filteredUrls.length,
        timeTaken,
        methods: methodCounts
      });

      return discoveryResult;

    } catch (error) {
      logger.error('URL discovery failed', {
        url,
        error: (error as Error).message,
        timeTaken: Date.now() - startTime
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * STREAMING URL DISCOVERY - Main streaming method for real-time URL processing
   * Runs all discovery methods in parallel and streams URLs as they're found
   */
  async streamDiscoverUrls(
    options: StreamingDiscoveryOptions,
    urlHandler: UrlStreamHandler
  ): Promise<StreamingDiscoveryResult> {
    const startTime = Date.now();
    const {
      url,
      maxUrls = 5000,
      includeSubdomains = true,
      searchQuery,
      skipSitemaps = false,
      sitemapsOnly = false,
      timeoutMs = 30000,
      includePatterns,
      excludePatterns,
      batchSize = 50
    } = options;

    // Validate input
    if (!URLValidationUtils.isValidUrl(url)) {
      throw new Error('Invalid URL provided');
    }

    logger.info('Starting streaming URL discovery', {
      url,
      maxUrls,
      includeSubdomains,
      batchSize,
      methods: sitemapsOnly ? 'sitemap-only' : skipSitemaps ? 'no-sitemap' : 'all'
    });

    // Track results across all methods
    let totalUrls = 0;
    let batchesProcessed = 0;
    const methodCounts = {
      sitemap: 0,
      browser: 0,
      commonPaths: 0,
      robots: 0,
      search: 0,
      documents: 0
    };

    // Create URL batch handler that filters and processes URLs
    const createBatchHandler = (method: keyof typeof methodCounts) => {
      return async (urls: string[]): Promise<void> => {
        if (urls.length === 0) return;

        // Filter URLs before processing
        const filterOptions = {
          includeSubdomains,
          includePatterns,
          excludePatterns,
          searchQuery,
          maxUrls: Math.min(batchSize, maxUrls - totalUrls)
        };

        const filteredUrls = URLValidationUtils.filterAndSortUrls(
          urls,
          url,
          filterOptions
        );

        if (filteredUrls.length > 0 && totalUrls < maxUrls) {
          const urlsToProcess = filteredUrls.slice(0, maxUrls - totalUrls);

          const batch: UrlBatch = {
            urls: urlsToProcess,
            method,
            batchNumber: ++batchesProcessed,
            totalProcessed: totalUrls + urlsToProcess.length
          };

          // Stream URLs to handler
          await urlHandler(batch);

          // Update counters
          totalUrls += urlsToProcess.length;
          methodCounts[method] += urlsToProcess.length;

          logger.debug(`Streamed URL batch from ${method}`, {
            batchSize: urlsToProcess.length,
            totalProcessed: totalUrls,
            batchNumber: batchesProcessed
          });
        }
      };
    };

    // Launch all discovery methods with streaming handlers
    const discoveryPromises: Promise<StreamingMethodResult>[] = [];

    if (!skipSitemaps) {
      discoveryPromises.push(
        this.streamSitemapDiscovery(url, timeoutMs, createBatchHandler('sitemap'))
      );

      discoveryPromises.push(
        this.streamRobotsDiscovery(url, timeoutMs, createBatchHandler('robots'))
      );
    }

    if (!sitemapsOnly) {
      // DISABLED: Browser discovery for /api/map to prevent resource exhaustion
      // Browser discovery launches full crawling which is too heavy for fast URL discovery
      // discoveryPromises.push(
      //   this.streamBrowserDiscovery(url, timeoutMs, maxUrls, createBatchHandler('browser'))
      // );

      discoveryPromises.push(
        this.streamCommonPathsDiscovery(url, timeoutMs, createBatchHandler('commonPaths'))
      );

      // Add document file discovery for PDF, DOC, PPT, etc.
      discoveryPromises.push(
        this.streamDocumentDiscovery(url, timeoutMs, createBatchHandler('documents'))
      );

    }

    // Execute all discovery methods in parallel
    const results = await Promise.allSettled(discoveryPromises);

    // Process results
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const methodResult = result.value;
        logger.info(`Streaming discovery method ${methodResult.method} completed`, {
          urlsFound: methodResult.urlsFound,
          batchesStreamed: methodResult.batchesStreamed,
          timeTaken: methodResult.timeTaken,
          completed: methodResult.completed,
          error: methodResult.error || 'none'
        });

        if (methodResult.urlsFound === 0) {
          logger.warn(`No URLs discovered by ${methodResult.method}`, {
            method: methodResult.method,
            completed: methodResult.completed,
            error: methodResult.error
          });
        }
      } else {
        logger.error('Streaming discovery method failed completely', {
          error: result.reason?.message || 'Unknown error',
          methodIndex: index,
          stack: result.reason?.stack
        });
      }
    });

    const timeTaken = Date.now() - startTime;
    const streamingResult: StreamingDiscoveryResult = {
      totalUrls,
      discoveryMethods: methodCounts,
      timeTaken,
      batchesProcessed,
      streamingComplete: true
    };

    logger.info('Streaming URL discovery completed', {
      url,
      totalUrls,
      batchesProcessed,
      timeTaken,
      methods: methodCounts
    });

    return streamingResult;
  }

  /**
   * STREAMING METHOD 1: Sitemap discovery with real-time URL streaming
   */
  private async streamSitemapDiscovery(
    url: string,
    timeout: number,
    urlHandler: (urls: string[]) => Promise<void>
  ): Promise<StreamingMethodResult> {
    const startTime = Date.now();
    let urlsFound = 0;
    let batchesStreamed = 0;

    try {
      logger.info('Starting streaming sitemap discovery', { url });

      // Use existing sitemap parser but with streaming callback
      const urls = await this.sitemapParser.discoverFromSitemaps(url, 10000);
      
      logger.info(`Sitemap discovery found ${urls.length} URLs`, { url, urlsFound: urls.length });

      if (urls.length === 0) {
        logger.warn('No URLs found via sitemap discovery', { url });
        return {
          method: 'sitemap',
          urlsFound: 0,
          batchesStreamed: 0,
          timeTaken: Date.now() - startTime,
          completed: true
        };
      }

      // Process URLs in batches for streaming
      const batchSize = 100;
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        await urlHandler(batch);
        urlsFound += batch.length;
        batchesStreamed++;
        
        logger.info(`Streamed sitemap batch ${batchesStreamed}`, { 
          batchSize: batch.length, 
          totalUrlsFound: urlsFound 
        });

        // Small delay to allow other methods to interleave
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      logger.info('Sitemap discovery completed successfully', { 
        url, 
        urlsFound, 
        batchesStreamed,
        timeTaken: Date.now() - startTime
      });

      return {
        method: 'sitemap',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: true
      };
    } catch (error) {
      logger.error('Sitemap discovery failed with error', { 
        url, 
        error: (error as Error).message,
        stack: (error as Error).stack,
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime
      });
      
      return {
        method: 'sitemap',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * STREAMING METHOD 2: Browser discovery with real-time URL streaming
   */
  private async streamBrowserDiscovery(
    url: string,
    timeout: number,
    maxUrls: number,
    urlHandler: (urls: string[]) => Promise<void>
  ): Promise<StreamingMethodResult> {
    const startTime = Date.now();
    let urlsFound = 0;
    let batchesStreamed = 0;

    try {
      logger.info('Starting streaming browser discovery', { url });

      // Use existing playwright service but with streaming approach
      const urls = await this.playwrightService.discoverUrls(url, {
        maxDepth: 3,
        discoveryLimit: Math.min(maxUrls, 1000),
        timeout: timeout
      });

      logger.info(`Browser discovery found ${urls.length} URLs`, { url, urlsFound: urls.length });

      if (urls.length === 0) {
        logger.warn('No URLs found via browser discovery', { url });
        return {
          method: 'browser',
          urlsFound: 0,
          batchesStreamed: 0,
          timeTaken: Date.now() - startTime,
          completed: true
        };
      }

      // Process URLs in smaller batches for better streaming
      const batchSize = 25;
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        await urlHandler(batch);
        urlsFound += batch.length;
        batchesStreamed++;

        logger.info(`Streamed browser batch ${batchesStreamed}`, { 
          batchSize: batch.length, 
          totalUrlsFound: urlsFound 
        });

        // Small delay to allow interleaving with other methods
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.info('Browser discovery completed successfully', { 
        url, 
        urlsFound, 
        batchesStreamed,
        timeTaken: Date.now() - startTime
      });

      return {
        method: 'browser',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: true
      };
    } catch (error) {
      logger.error('Browser discovery failed with error', { 
        url, 
        error: (error as Error).message,
        stack: (error as Error).stack,
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime
      });
      
      return {
        method: 'browser',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * STREAMING METHOD 3: Common paths discovery with real-time URL streaming
   */
  private async streamCommonPathsDiscovery(
    url: string,
    timeout: number,
    urlHandler: (urls: string[]) => Promise<void>
  ): Promise<StreamingMethodResult> {
    const startTime = Date.now();
    let urlsFound = 0;
    let batchesStreamed = 0;

    try {
      logger.debug('Starting streaming common paths discovery', { url });

      // Generate common paths to test
      const baseUrl = new URL(url);
      const commonPaths = [
        '/api', '/api/v1', '/api/v2', '/docs', '/documentation',
        '/swagger', '/openapi.json', '/graphql', '/health',
        '/status', '/metrics', '/admin', '/dashboard', '/login',
        '/register', '/profile', '/settings', '/help', '/support',
        '/blog', '/news', '/about', '/contact', '/privacy',
        '/terms', '/security', '/pricing', '/features',
        // Document-specific paths for comprehensive discovery
        '/files', '/documents', '/attachments', '/assets',
        '/media', '/presentations', '/reports', '/whitepapers',
        '/publications', '/library', '/archive', '/repository',
        '/static', '/public', '/content', '/data'
      ];

      const testUrls = commonPaths.map(path => baseUrl.origin + path);

      // Test URLs in small batches and stream successful ones with timeout protection
      const batchSize = 5;
      for (let i = 0; i < testUrls.length; i += batchSize) {
        // Check if we're running out of time
        if (Date.now() - startTime > timeout * 0.8) { // Use 80% of available time
          logger.info('Common paths discovery timeout approaching, stopping early', { 
            url, 
            testedSoFar: i,
            urlsFound 
          });
          break;
        }

        const batch = testUrls.slice(i, i + batchSize);

        // Test which URLs exist with shorter timeout
        const existingUrls = await Promise.all(
          batch.map(async (testUrl) => {
            try {
              const exists = await URLValidationUtils.checkUrlExists(testUrl, 2000); // Reduced from 3000 to 2000ms
              return exists ? testUrl : null;
            } catch {
              return null;
            }
          })
        );

        const validUrls = existingUrls.filter(url => url !== null) as string[];

        if (validUrls.length > 0) {
          await urlHandler(validUrls);
          urlsFound += validUrls.length;
          batchesStreamed++;
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return {
        method: 'commonPaths',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: true
      };
    } catch (error) {
      return {
        method: 'commonPaths',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * STREAMING METHOD 4: Robots.txt sitemap discovery with real-time URL streaming
   */
  private async streamRobotsDiscovery(
    url: string,
    timeout: number,
    urlHandler: (urls: string[]) => Promise<void>
  ): Promise<StreamingMethodResult> {
    const startTime = Date.now();
    let urlsFound = 0;
    let batchesStreamed = 0;

    try {
      logger.debug('Starting streaming robots discovery', { url });

      const baseUrl = new URL(url);
      const robotsUrl = `${baseUrl.origin}/robots.txt`;

      // Fetch and parse robots.txt
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'DeepScraper/1.0 Discovery Bot' }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const robotsContent = await response.text();
        const sitemapUrls: string[] = [];

        // Extract sitemap URLs from robots.txt
        const lines = robotsContent.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.toLowerCase().startsWith('sitemap:')) {
            const sitemapUrl = trimmed.substring(8).trim();
            if (URLValidationUtils.isValidUrl(sitemapUrl)) {
              sitemapUrls.push(sitemapUrl);
            }
          }
        }

        // Process each sitemap found in robots.txt
        for (const sitemapUrl of sitemapUrls) {
          try {
            const urls = await this.sitemapParser.parseSitemap(sitemapUrl);
            if (urls.length > 0) {
              // Stream in batches
              const batchSize = 50;
              for (let i = 0; i < urls.length; i += batchSize) {
                const batch = urls.slice(i, i + batchSize);
                await urlHandler(batch);
                urlsFound += batch.length;
                batchesStreamed++;

                await new Promise(resolve => setTimeout(resolve, 20));
              }
            }
          } catch (error) {
            logger.debug(`Failed to parse sitemap from robots.txt: ${sitemapUrl}`, {
              error: (error as Error).message
            });
          }
        }
      }

      return {
        method: 'robots',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: true
      };
    } catch (error) {
      return {
        method: 'robots',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: false,
        error: (error as Error).message
      };
    }
  }


  /**
   * STREAMING METHOD 6: Document file discovery with real-time URL streaming
   */
  private async streamDocumentDiscovery(
    url: string,
    timeout: number,
    urlHandler: (urls: string[]) => Promise<void>
  ): Promise<StreamingMethodResult> {
    const startTime = Date.now();
    let urlsFound = 0;
    let batchesStreamed = 0;

    try {
      logger.info('Starting streaming document file discovery', { url });

      const baseUrl = new URL(url);
      
      // Common document file extensions to test
      const documentExtensions = [
        '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
        '.txt', '.rtf', '.odt', '.ods', '.odp', '.csv', '.json',
        '.xml', '.yaml', '.yml', '.zip', '.rar', '.7z', '.tar', '.gz'
      ];

      // Common document paths and filenames
      const documentPaths = [
        '/documents', '/files', '/downloads', '/assets', '/media',
        '/attachments', '/resources', '/static', '/public', '/content'
      ];

      const commonDocumentNames = [
        'readme', 'manual', 'guide', 'tutorial', 'documentation',
        'whitepaper', 'report', 'presentation', 'overview', 'datasheet',
        'brochure', 'catalog', 'specification', 'api-reference',
        'user-guide', 'installation', 'getting-started', 'quickstart'
      ];

      const testUrls: string[] = [];

      // Generate test URLs by combining paths, names, and extensions
      for (const path of documentPaths) {
        for (const name of commonDocumentNames.slice(0, 5)) { // Limit to avoid too many requests
          for (const ext of documentExtensions.slice(0, 8)) { // Focus on most common extensions
            testUrls.push(`${baseUrl.origin}${path}/${name}${ext}`);
          }
        }
      }

      // Also test some common specific document URLs in root
      const specificDocuments = [
        '/api.pdf', '/documentation.pdf', '/manual.pdf', '/guide.pdf',
        '/readme.txt', '/changelog.txt', '/license.txt',
        '/presentation.pptx', '/overview.pptx', '/demo.pptx',
        '/data.xlsx', '/export.csv', '/backup.zip'
      ];

      testUrls.push(...specificDocuments.map(doc => `${baseUrl.origin}${doc}`));

      logger.info(`Testing ${testUrls.length} potential document URLs`, { url });

      // Test URLs in batches to avoid overwhelming the server
      const batchSize = 3; // Smaller batches to be more respectful
      const maxTests = Math.min(testUrls.length, 50); // Limit to 50 tests for faster discovery
      
      for (let i = 0; i < maxTests; i += batchSize) {
        // Check if we're running out of time
        if (Date.now() - startTime > timeout * 0.8) { // Use 80% of available time
          logger.info('Document discovery timeout approaching, stopping early', { 
            url, 
            testedSoFar: i,
            urlsFound 
          });
          break;
        }

        const batch = testUrls.slice(i, i + batchSize);

        // Test which URLs exist with timeout
        const existingUrls = await Promise.all(
          batch.map(async (testUrl) => {
            try {
              const exists = await URLValidationUtils.checkUrlExists(testUrl, 1500); // Very short timeout
              return exists ? testUrl : null;
            } catch {
              return null;
            }
          })
        );

        const validUrls = existingUrls.filter(url => url !== null) as string[];

        if (validUrls.length > 0) {
          await urlHandler(validUrls);
          urlsFound += validUrls.length;
          batchesStreamed++;
          
          logger.info(`Found ${validUrls.length} document files`, { 
            urls: validUrls.slice(0, 2) // Log first 2 for debugging
          });
        }

        // Small delay between batches to be respectful
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info('Document discovery completed successfully', { 
        url, 
        urlsFound, 
        batchesStreamed,
        timeTaken: Date.now() - startTime
      });

      return {
        method: 'documents',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: true
      };
    } catch (error) {
      logger.error('Document discovery failed with error', { 
        url, 
        error: (error as Error).message,
        stack: (error as Error).stack,
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime
      });
      
      return {
        method: 'documents',
        urlsFound,
        batchesStreamed,
        timeTaken: Date.now() - startTime,
        completed: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Method 1: Enhanced sitemap discovery
   */
  private async runSitemapDiscovery(url: string, limit: number): Promise<DiscoveryMethodResult> {
    const startTime = Date.now();
    try {
      const urls = await this.sitemapParser.discoverFromSitemaps(url, limit);
      return {
        urls,
        method: 'sitemap',
        timeTaken: Date.now() - startTime
      };
    } catch (error) {
      return {
        urls: [],
        method: 'sitemap',
        timeTaken: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }


  /**
   * Method 3: Browser-based crawling discovery
   */
  private async runBrowserDiscovery(url: string, limit: number, rateLimiting?: any, crawlOptions?: any): Promise<DiscoveryMethodResult> {
    const startTime = Date.now();
    try {
      // Configure crawling parameters with defaults
      const crawlConfig = {
        maxDepth: crawlOptions?.maxCrawlDepth || 3,
        discoveryLimit: limit,
        timeout: crawlOptions?.crawlTimeoutPerPage || 3000,
        maxConcurrency: crawlOptions?.maxConcurrentCrawlers || 8,
        maxLinksPerPage: crawlOptions?.maxLinksPerPage || 100,
        enableDeepCrawling: crawlOptions?.enableDeepCrawling !== false,
        browserPoolSize: crawlOptions?.browserPoolSize || 5
      };

      logger.info('Starting enhanced browser crawling', {
        url,
        config: crawlConfig
      });

      // Dynamically resize browser pool if needed
      if (crawlOptions?.browserPoolSize) {
        const { BrowserPoolService } = await import('./browser-pool.service');
        const browserPool = BrowserPoolService.getInstance();
        await browserPool.resizePool(crawlOptions.browserPoolSize);
        
        logger.info('Browser pool resized for crawling', {
          browserPoolSize: crawlOptions.browserPoolSize
        });
      }

      // Use existing playwright service for browser-based discovery
      const urls = await this.playwrightService.discoverUrls(url, crawlConfig);

      logger.info('Browser crawling completed', {
        url,
        urlsFound: urls.length,
        timeTaken: Date.now() - startTime
      });

      return {
        urls,
        method: 'crawling',
        timeTaken: Date.now() - startTime
      };
    } catch (error) {
      logger.error('Browser crawling failed', {
        url,
        error: (error as Error).message,
        timeTaken: Date.now() - startTime
      });
      
      return {
        urls: [],
        method: 'crawling',
        timeTaken: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Method 4: Common paths discovery with rate limiting
   */
  private async runCommonPathsDiscovery(url: string, rateLimiting?: any): Promise<DiscoveryMethodResult> {
    const startTime = Date.now();
    try {
      const baseUrl = new URL(url).origin;
      let commonPaths = [
        '/api', '/docs', '/documentation', '/help', '/support',
        '/blog', '/news', '/articles', '/posts', '/guides',
        '/products', '/services', '/about', '/contact',
        '/pricing', '/features', '/tutorials', '/faq',
        '/downloads', '/resources', '/tools', '/api/docs',
        '/swagger', '/openapi', '/graphql', '/rest',
        '/v1', '/v2', '/api/v1', '/api/v2',
        // Document-specific paths for comprehensive discovery
        '/files', '/documents', '/attachments', '/assets',
        '/media', '/presentations', '/reports', '/whitepapers',
        '/publications', '/library', '/archive', '/repository',
        '/static', '/public', '/content', '/data'
      ];

      // Add Microsoft Learn specific paths for Azure discovery
      if (url.includes('learn.microsoft.com') && url.includes('/azure/')) {
        commonPaths = [
          '/en-us/azure/', '/azure/', 
          '/en-us/azure/active-directory/', '/en-us/azure/app-service/',
          '/en-us/azure/virtual-machines/', '/en-us/azure/storage/',
          '/en-us/azure/cosmos-db/', '/en-us/azure/sql-database/',
          '/en-us/azure/functions/', '/en-us/azure/kubernetes-service/',
          '/en-us/azure/machine-learning/', '/en-us/azure/cognitive-services/',
          '/en-us/azure/devops/', '/en-us/azure/security/',
          '/en-us/azure/architecture/', '/en-us/azure/governance/',
          // Common Microsoft Learn patterns
          '/docs', '/api', '/tutorials', '/samples', '/reference'
        ];
      }

      // Test common paths - use batching if rate limiting is specified
      let urls: string[] = [];
      
      // Force aggressive rate limiting for Microsoft Learn to avoid blocking
      const forceBatching = url.includes('microsoft.com');
      const effectiveBatchSize = forceBatching ? 2 : (rateLimiting?.batchSize || commonPaths.length);
      const effectiveDelay = forceBatching ? 1000 : (rateLimiting?.sitemapDelay || 0);
      
      if (effectiveBatchSize < commonPaths.length) {
        // Use batched approach for rate limiting
        for (let i = 0; i < commonPaths.length; i += effectiveBatchSize) {
          const batch = commonPaths.slice(i, i + effectiveBatchSize);
          
          const batchPromises = batch.map(async (path) => {
            const testUrl = baseUrl + path;
            try {
              const timeout = url.includes('microsoft.com') ? 1000 : 3000; // Faster timeout for Microsoft
              const exists = await URLValidationUtils.checkUrlExists(testUrl, timeout);
              return exists ? testUrl : null;
            } catch {
              return null;
            }
          });

          const batchResults = await Promise.allSettled(batchPromises);
          const batchUrls = batchResults
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => (result as PromiseFulfilledResult<string>).value);
          
          urls.push(...batchUrls);
          
          // Add delay between batches if specified
          if (i + effectiveBatchSize < commonPaths.length && effectiveDelay > 0) {
            await this.delay(effectiveDelay);
          }
        }
      } else {
        // Use full parallel approach for maximum performance
        const pathPromises = commonPaths.map(async (path) => {
          const testUrl = baseUrl + path;
          try {
            const timeout = url.includes('microsoft.com') ? 1000 : 3000; // Faster timeout for Microsoft
            const exists = await URLValidationUtils.checkUrlExists(testUrl, timeout);
            return exists ? testUrl : null;
          } catch {
            return null;
          }
        });

        const results = await Promise.allSettled(pathPromises);
        urls = results
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => (result as PromiseFulfilledResult<string>).value);
      }

      return {
        urls,
        method: 'commonPaths',
        timeTaken: Date.now() - startTime
      };
    } catch (error) {
      return {
        urls: [],
        method: 'commonPaths',
        timeTaken: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Method 5: Robots.txt sitemap discovery
   */
  private async runRobotsSitemapDiscovery(url: string): Promise<DiscoveryMethodResult> {
    const startTime = Date.now();
    try {
      const urls = await this.sitemapParser.extractSitemapsFromRobots(url);
      return {
        urls,
        method: 'robotsSitemaps',
        timeTaken: Date.now() - startTime
      };
    } catch (error) {
      return {
        urls: [],
        method: 'robotsSitemaps',
        timeTaken: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Document discovery - find URLs ending with PDF, PPT, PPTX, DOC, etc.
   */
  private async runDocumentDiscovery(url: string, rateLimiting?: any): Promise<DiscoveryMethodResult> {
    const startTime = Date.now();
    
    try {
      // Add timeout protection
      const timeoutMs = rateLimiting?.browserTimeout || 10000;
      const timeoutPromise = new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('Document discovery timeout')), timeoutMs)
      );

      const discoveryPromise = this.discoverDocumentUrls(url, rateLimiting);
      
      const urls = await Promise.race([discoveryPromise, timeoutPromise]);
      
      return {
        urls,
        method: 'documents',
        timeTaken: Date.now() - startTime
      };
    } catch (error) {
      logger.warn('Document discovery failed', {
        url,
        error: (error as Error).message
      });
      return {
        urls: [],
        method: 'documents',
        timeTaken: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Discover document URLs by checking common paths and extensions
   */
  private async discoverDocumentUrls(url: string, rateLimiting?: any): Promise<string[]> {
    const baseUrl = new URL(url).origin;
    const documentUrls: string[] = [];
    
    // Document file extensions to discover
    const documentExtensions = [
      '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
      '.txt', '.rtf', '.odt', '.ods', '.odp', '.csv', '.json',
      '.xml', '.yaml', '.yml', '.zip', '.rar', '.7z', '.tar', '.gz'
    ];

    // Common document paths
    const documentPaths = [
      '/documents/', '/docs/', '/files/', '/downloads/', '/media/',
      '/assets/', '/resources/', '/uploads/', '/content/', '/papers/',
      '/reports/', '/manuals/', '/guides/', '/help/', '/documentation/',
      '/pdf/', '/pdfs/', '/doc/', '/download/', '/file/', '/attachment/',
      '/attachments/', '/static/', '/public/', '/shared/'
    ];

    // Generate potential document URLs
    const potentialUrls: string[] = [];
    
    // Add document paths with extensions
    for (const path of documentPaths) {
      for (const ext of documentExtensions) {
        potentialUrls.push(`${baseUrl}${path}sample${ext}`);
        potentialUrls.push(`${baseUrl}${path}index${ext}`);
        potentialUrls.push(`${baseUrl}${path}main${ext}`);
        potentialUrls.push(`${baseUrl}${path}document${ext}`);
        potentialUrls.push(`${baseUrl}${path}file${ext}`);
      }
    }

    // Add root level document files
    for (const ext of documentExtensions) {
      potentialUrls.push(`${baseUrl}/readme${ext}`);
      potentialUrls.push(`${baseUrl}/manual${ext}`);
      potentialUrls.push(`${baseUrl}/guide${ext}`);
      potentialUrls.push(`${baseUrl}/documentation${ext}`);
      potentialUrls.push(`${baseUrl}/spec${ext}`);
      potentialUrls.push(`${baseUrl}/specification${ext}`);
    }

    // Check URLs in batches with rate limiting
    const batchSize = rateLimiting?.batchSize || 5;
    const minDelay = rateLimiting?.minDelay || 500;
    
    for (let i = 0; i < potentialUrls.length; i += batchSize) {
      const batch = potentialUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (docUrl) => {
        try {
          const response = await axios.head(docUrl, {
            timeout: 5000,
            headers: { 'User-Agent': 'DeepScraper/1.0 Document Discovery' },
            validateStatus: (status) => status < 400
          });
          
          if (response.status === 200) {
            return docUrl;
          }
        } catch (error) {
          // URL doesn't exist or is not accessible
        }
        return null;
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          documentUrls.push(result.value);
        }
      });

      // Rate limiting delay between batches
      if (i + batchSize < potentialUrls.length) {
        await this.delay(minDelay);
      }
    }

    logger.info('Document discovery completed', {
      url,
      documentsFound: documentUrls.length,
      totalChecked: potentialUrls.length
    });

    return documentUrls;
  }


  /**
   * Generate cache key for discovery options
   */
  private generateCacheKey(options: DiscoveryOptions): string {
    const keyData = {
      url: options.url,
      maxUrls: options.maxUrls,
      includeSubdomains: options.includeSubdomains,
      searchQuery: options.searchQuery,
      skipSitemaps: options.skipSitemaps,
      sitemapsOnly: options.sitemapsOnly,
      includePatterns: options.includePatterns?.sort(),
      excludePatterns: options.excludePatterns?.sort()
    };

    const keyString = JSON.stringify(keyData);
    const hash = require('crypto').createHash('sha256').update(keyString).digest('hex');
    return `${this.cachePrefix}:${hash}`;
  }

  /**
   * Get cached discovery result
   */
  private async getCachedResult(cacheKey: string): Promise<DiscoveryResult | null> {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as DiscoveryResult;
        result.fromCache = true;
        return result;
      }
    } catch (error) {
      logger.debug('Failed to get cached discovery result', {
        cacheKey,
        error: (error as Error).message
      });
    }
    return null;
  }

  /**
   * Cache discovery result
   */
  private async cacheResult(cacheKey: string, result: DiscoveryResult): Promise<void> {
    try {
      await redisClient.setex(cacheKey, this.cacheDuration, JSON.stringify(result));
      logger.debug('Cached discovery result', { cacheKey, urlCount: result.links.length });
    } catch (error) {
      logger.warn('Failed to cache discovery result', {
        cacheKey,
        error: (error as Error).message
      });
    }
  }

  /**
   * Clear discovery cache for a specific URL
   */
  async clearCache(url: string): Promise<void> {
    try {
      const pattern = `${this.cachePrefix}:*`;
      const keys = await redisClient.keys(pattern);

      // Filter keys that contain the URL
      const urlKeys = keys.filter(key => key.includes(encodeURIComponent(url)));

      if (urlKeys.length > 0) {
        await redisClient.del(...urlKeys);
        logger.info('Cleared discovery cache', { url, keysCleared: urlKeys.length });
      }
    } catch (error) {
      logger.warn('Failed to clear discovery cache', {
        url,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ totalKeys: number; totalSize: string }> {
    try {
      const pattern = `${this.cachePrefix}:*`;
      const keys = await redisClient.keys(pattern);

      let totalSize = 0;
      for (const key of keys) {
        const size = await redisClient.strlen(key);
        totalSize += size;
      }

      return {
        totalKeys: keys.length,
        totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`
      };
    } catch (error) {
      logger.warn('Failed to get cache stats', { error: (error as Error).message });
      return { totalKeys: 0, totalSize: '0 MB' };
    }
  }
}
