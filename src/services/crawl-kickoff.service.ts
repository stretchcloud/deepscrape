import { logger } from '../utils/logger';
import { URLDiscoveryService } from './url-discovery.service';
import { addCrawlJob } from './redis.service';
import { addCrawlJobToQueue } from './queue.service';
import {
  CrawlKickoffOptions,
  CrawlKickoffResult,
  StreamingDiscoveryOptions,
  UrlBatch
} from '../types/streaming-crawl';

/**
 * Crawl Kickoff Service - Implements 3-stage streaming architecture
 *
 * Stage 1: Kickoff Job - Immediate initial scraping + parallel discovery launch
 * Stage 2: Streaming Discovery - Real-time URL streaming to scrape queue
 * Stage 3: Parallel Processing - Multiple workers process URLs as they're discovered
 */
export class CrawlKickoffService {
  private readonly discoveryService: URLDiscoveryService;

  constructor() {
    this.discoveryService = new URLDiscoveryService();
  }

  /**
   * STAGE 1: Kickoff Job - Start streaming crawl with immediate initial scraping
   */
  async startStreamingCrawl(options: CrawlKickoffOptions): Promise<CrawlKickoffResult> {
    const {
      crawlId,
      url,
      limit = 100,
      maxDepth = 5,
      allowSubdomains = false,
      includePaths = [],
      excludePaths = [],
      scrapeOptions = {},
      useMapDiscovery = false,
      concurrency = 3
    } = options;

    logger.info('Starting streaming crawl kickoff', {
      crawlId,
      url,
      limit,
      useMapDiscovery,
      concurrency
    });

    try {
      // STAGE 1A: Immediate initial URL scraping
      const initialJobId = await this.addInitialScrapeJob(crawlId, url, scrapeOptions);

      logger.info('Initial scrape job added', { crawlId, url, jobId: initialJobId });

      // STAGE 1B: Launch streaming discovery (if enabled)
      let discoveryStarted = false;
      if (useMapDiscovery) {
        // Start streaming discovery in background (non-blocking)
        this.startStreamingDiscovery(crawlId, url, {
          limit,
          allowSubdomains,
          includePaths,
          excludePaths,
          scrapeOptions
        }).catch(error => {
          logger.error('Streaming discovery failed', {
            crawlId,
            error: error.message
          });
        });

        discoveryStarted = true;
        logger.info('Streaming discovery launched', { crawlId });
      } else {
        // Traditional browser-based discovery will be handled by the scraper workers
        logger.info('Using traditional browser-based discovery', { crawlId });
      }

      return {
        success: true,
        crawlId,
        initialJobId,
        discoveryStarted,
        estimatedUrls: useMapDiscovery ? limit : maxDepth * 10,
        message: `Streaming crawl initiated. ${discoveryStarted ? 'Discovery streaming started.' : 'Using traditional discovery.'}`
      };

    } catch (error) {
      logger.error('Crawl kickoff failed', {
        crawlId,
        error: (error as Error).message
      });

      return {
        success: false,
        crawlId,
        initialJobId: '',
        discoveryStarted: false,
        message: `Crawl kickoff failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * STAGE 2: Streaming Discovery - Real-time URL discovery with immediate queue addition
   */
  private async startStreamingDiscovery(
    crawlId: string,
    url: string,
    options: {
      limit: number;
      allowSubdomains: boolean;
      includePaths: string[];
      excludePaths: string[];
      scrapeOptions: any;
    }
  ): Promise<void> {
    const { limit, allowSubdomains, includePaths, excludePaths, scrapeOptions } = options;

    logger.info('Starting streaming URL discovery', {
      crawlId,
      url,
      limit,
      allowSubdomains
    });

    const streamingOptions: StreamingDiscoveryOptions = {
      url,
      maxUrls: limit,
      includeSubdomains: allowSubdomains,
      includePatterns: includePaths,
      excludePatterns: excludePaths,
      batchSize: 25, // Process URLs in small batches for better streaming
      timeoutMs: 30000
    };

    // Create URL stream handler that adds discovered URLs to crawl queue immediately
    const urlStreamHandler = async (batch: UrlBatch): Promise<void> => {
      try {
        logger.debug('Processing URL batch from streaming discovery', {
          crawlId,
          method: batch.method,
          batchNumber: batch.batchNumber,
          urlCount: batch.urls.length,
          totalProcessed: batch.totalProcessed
        });

        // Add each URL to the crawl queue immediately
        const jobPromises = batch.urls.map(discoveredUrl =>
          this.addDiscoveredUrlToQueue(crawlId, discoveredUrl, batch.method, scrapeOptions)
        );

        await Promise.allSettled(jobPromises);

        logger.debug('URL batch queued successfully', {
          crawlId,
          method: batch.method,
          batchNumber: batch.batchNumber,
          urlsQueued: batch.urls.length
        });

      } catch (error) {
        logger.error('Failed to process URL batch', {
          crawlId,
          method: batch.method,
          batchNumber: batch.batchNumber,
          error: (error as Error).message
        });
      }
    };

    try {
      // Start streaming discovery with real-time URL processing
      const result = await this.discoveryService.streamDiscoverUrls(
        streamingOptions,
        urlStreamHandler
      );

      logger.info('Streaming discovery completed', {
        crawlId,
        totalUrls: result.totalUrls,
        batchesProcessed: result.batchesProcessed,
        timeTaken: result.timeTaken,
        methods: result.discoveryMethods
      });

    } catch (error) {
      logger.error('Streaming discovery failed', {
        crawlId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Add initial URL to scrape queue (Stage 1A)
   */
  private async addInitialScrapeJob(
    crawlId: string,
    url: string,
    scrapeOptions: any
  ): Promise<string> {
    try {
      const jobData = {
        url,
        mode: 'streaming-initial',
        scrapeOptions: {
          ...scrapeOptions,
          extractorFormat: scrapeOptions.extractorFormat || 'markdown',
          streamingDiscovery: true
        }
      };

      // Use addCrawlJobToQueue which handles job creation and queuing
      const jobId = await addCrawlJobToQueue(crawlId, jobData, 5); // High priority for initial job

      logger.debug('Initial scrape job created', {
        crawlId,
        url,
        jobId
      });

      return jobId;
    } catch (error) {
      logger.error('Failed to add initial scrape job', {
        crawlId,
        url,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Add discovered URL to crawl queue (Stage 2)
   */
  private async addDiscoveredUrlToQueue(
    crawlId: string,
    url: string,
    discoveryMethod: string,
    scrapeOptions: any
  ): Promise<void> {
    try {
      const jobData = {
        url,
        mode: 'streaming-discovered',
        scrapeOptions: {
          ...scrapeOptions,
          extractorFormat: scrapeOptions.extractorFormat || 'markdown',
          discoveryMethod, // Track how this URL was discovered
          streamingDiscovery: true // Mark as streaming discovery
        }
      };

      // Use addCrawlJobToQueue which handles job creation and queuing
      await addCrawlJobToQueue(crawlId, jobData, 15); // Lower priority than initial job

      logger.debug('Discovered URL queued', {
        crawlId,
        url,
        discoveryMethod
      });

    } catch (error) {
      logger.error('Failed to queue discovered URL', {
        crawlId,
        url,
        discoveryMethod,
        error: (error as Error).message
      });
      // Don't throw - we want to continue processing other URLs
    }
  }

  /**
   * Get streaming crawl statistics
   */
  async getStreamingStats(crawlId: string): Promise<{
    totalJobsQueued: number;
    discoveryComplete: boolean;
    estimatedCompletion: string;
  }> {
    // This would integrate with Redis to get actual job counts
    // For now, return placeholder data
    return {
      totalJobsQueued: 0,
      discoveryComplete: false,
      estimatedCompletion: 'unknown'
    };
  }
}
