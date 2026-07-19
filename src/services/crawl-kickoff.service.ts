import { logger } from '../utils/logger';
import { URLDiscoveryService } from './url-discovery.service';
import {
  markStreamingDiscoveryActive,
  markStreamingDiscoveryComplete,
  markCrawlKickoffFinished,
  lockCrawlUrl
} from './redis.service';
import { addCrawlJobToQueue } from './queue.service';
import { UrlNormalizationService } from './url-normalization.service';
import {
  CrawlKickoffOptions,
  CrawlKickoffResult,
  StreamingDiscoveryOptions,
  UrlBatch
} from '../types/streaming-crawl';

/**
 * Crawl Kickoff Service - Implements a 3-stage streaming architecture
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
      concurrency = 3,
      mapDiscoveryOptions = {}
    } = options;

    logger.info('Starting streaming crawl kickoff', {
      crawlId,
      url,
      limit,
      useMapDiscovery,
      concurrency
    });

    try {
      // Claim the seed URL so map discovery doesn't re-queue it as a duplicate.
      await lockCrawlUrl(crawlId, UrlNormalizationService.normalizeUrl(url));

      // STAGE 1A: Immediate initial URL scraping
      const initialJobId = await this.addInitialScrapeJob(crawlId, url, scrapeOptions);

      logger.info('Initial scrape job added', { crawlId, url, jobId: initialJobId });

      // STAGE 1B: Launch streaming discovery (if enabled)
      let discoveryStarted = false;
      if (useMapDiscovery) {
        // Mark streaming discovery as active to prevent premature crawl completion.
        // Set this BEFORE the kickoff-finished marker so the completion gate can't
        // fire in the window between the two.
        await markStreamingDiscoveryActive(crawlId);

        // Start map discovery in background (non-blocking) with proper error handling
        this.startStreamingDiscovery(crawlId, url, {
          limit,
          allowSubdomains,
          includePaths,
          excludePaths,
          scrapeOptions,
          mapDiscoveryOptions
        }).then(() => {
          logger.info('Map discovery completed and URLs queued', { crawlId });
        }).catch(error => {
          logger.error('Map discovery failed', {
            crawlId,
            error: error.message
          });
          // Mark as complete even on error to prevent hanging
          markStreamingDiscoveryComplete(crawlId).catch(err =>
            logger.error('Failed to mark streaming discovery as complete after error', { crawlId, err })
          );
        });

        discoveryStarted = true;
        logger.info('Streaming discovery launched', { crawlId });
      } else {
        // Traditional browser-based discovery will be handled by the scraper workers
        logger.info('Using traditional browser-based discovery', { crawlId });
      }

      // Initial job(s) are queued and discovery (if any) is marked active — allow
      // completion detection to proceed once all jobs and discovery finish.
      await markCrawlKickoffFinished(crawlId);

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
   * STAGE 2: Simple Map-Based Discovery - Use working /api/map internally
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
      mapDiscoveryOptions?: any;
    }
  ): Promise<void> {
    const { limit, allowSubdomains, includePaths, excludePaths, scrapeOptions, mapDiscoveryOptions = {} } = options;

    logger.info('Starting map-based URL discovery (using internal /api/map)', {
      crawlId,
      url,
      limit,
      allowSubdomains
    });

    try {
      // Call the working map discovery internally
      const mapResult = await this.discoveryService.discoverUrls({
        url,
        maxUrls: limit,
        includeSubdomains: allowSubdomains,
        includePatterns: includePaths,
        excludePatterns: excludePaths,
        timeoutMs: mapDiscoveryOptions.timeoutMs || 120000,
        skipSitemaps: mapDiscoveryOptions.skipSitemaps || false,
        sitemapsOnly: mapDiscoveryOptions.sitemapsOnly || false
      });

      logger.info('Map discovery completed', {
        crawlId,
        totalUrls: mapResult.links.length,
        timeTaken: mapResult.timeTaken,
        methods: mapResult.discoveryMethods
      });

      // Add all discovered URLs to the crawl queue
      let urlsQueued = 0;
      for (const discoveredUrl of mapResult.links) {
        try {
          await this.addDiscoveredUrlToQueue(crawlId, discoveredUrl, 'map-discovery', scrapeOptions);
          urlsQueued++;
        } catch (error) {
          logger.warn('Failed to queue discovered URL', {
            crawlId,
            url: discoveredUrl,
            error: (error as Error).message
          });
        }
      }

      logger.info('Map discovery URLs queued successfully', {
        crawlId,
        totalDiscovered: mapResult.links.length,
        urlsQueued
      });

      // Mark streaming discovery as complete so the crawl can finish
      await markStreamingDiscoveryComplete(crawlId);

    } catch (error) {
      logger.error('Map-based discovery failed', {
        crawlId,
        error: (error as Error).message
      });

      // Mark as complete even on error to prevent hanging
      await markStreamingDiscoveryComplete(crawlId);
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
      // Atomic dedup: skip URLs already claimed (e.g. the seed, or found by
      // multiple discovery methods) so they aren't scraped/exported twice.
      const isNew = await lockCrawlUrl(crawlId, UrlNormalizationService.normalizeUrl(url));
      if (!isNew) {
        logger.debug('Skipping already-seen discovered URL', { crawlId, url });
        return;
      }

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
