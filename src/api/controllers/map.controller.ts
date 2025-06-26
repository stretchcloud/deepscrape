import { Request, Response } from 'express';
import { URLDiscoveryService } from '../../services/url-discovery.service';
import { logger } from '../../utils/logger';
import { MapRequest, MapResponse, DiscoveryOptions } from '../../types/discovery';

/**
 * Controller for the /api/map endpoint - URL discovery service
 */
export class MapController {
  private readonly discoveryService: URLDiscoveryService;

  constructor() {
    this.discoveryService = new URLDiscoveryService();
  }

  /**
   * Main map endpoint - discover URLs from a website
   */
  async discoverUrls(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const {
        url,
        maxUrls = 5000,
        includeSubdomains = true,
        searchQuery,
        skipSitemaps = false,
        sitemapsOnly = false,
        useUrlIndex = true,
        timeoutMs = 30000,
        includePatterns,
        excludePatterns,
        // Rate limiting options
        rateLimitingOptions = {},
        // NEW: Crawl options
        crawlOptions = {}
      } = req.body as MapRequest;

      // Validate required fields
      if (!url) {
        res.status(400).json({
          success: false,
          error: 'URL is required'
        });
        return;
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        res.status(400).json({
          success: false,
          error: 'Invalid URL format'
        });
        return;
      }

      // Validate maxUrls
      if (maxUrls < 1 || maxUrls > 30000) {
        res.status(400).json({
          success: false,
          error: 'maxUrls must be between 1 and 30,000'
        });
        return;
      }

      // Validate timeoutMs
      if (timeoutMs < 1000 || timeoutMs > 300000) {
        res.status(400).json({
          success: false,
          error: 'timeoutMs must be between 1,000ms and 300,000ms (5 minutes)'
        });
        return;
      }

      // Validate crawl options
      if (crawlOptions.maxCrawlDepth !== undefined && (crawlOptions.maxCrawlDepth < 1 || crawlOptions.maxCrawlDepth > 5)) {
        res.status(400).json({
          success: false,
          error: 'maxCrawlDepth must be between 1 and 5'
        });
        return;
      }

      if (crawlOptions.maxConcurrentCrawlers !== undefined && (crawlOptions.maxConcurrentCrawlers < 1 || crawlOptions.maxConcurrentCrawlers > 20)) {
        res.status(400).json({
          success: false,
          error: 'maxConcurrentCrawlers must be between 1 and 20'
        });
        return;
      }

      if (crawlOptions.crawlTimeoutPerPage !== undefined && (crawlOptions.crawlTimeoutPerPage < 1000 || crawlOptions.crawlTimeoutPerPage > 10000)) {
        res.status(400).json({
          success: false,
          error: 'crawlTimeoutPerPage must be between 1,000ms and 10,000ms'
        });
        return;
      }

      if (crawlOptions.maxLinksPerPage !== undefined && (crawlOptions.maxLinksPerPage < 1 || crawlOptions.maxLinksPerPage > 500)) {
        res.status(400).json({
          success: false,
          error: 'maxLinksPerPage must be between 1 and 500'
        });
        return;
      }

      if (crawlOptions.browserPoolSize !== undefined && (crawlOptions.browserPoolSize < 1 || crawlOptions.browserPoolSize > 15)) {
        res.status(400).json({
          success: false,
          error: 'browserPoolSize must be between 1 and 15'
        });
        return;
      }

      logger.info('Starting URL discovery', {
        url,
        maxUrls,
        includeSubdomains,
        searchQuery: searchQuery ? '[QUERY PROVIDED]' : undefined,
        sitemapsOnly,
        skipSitemaps,
        crawlOptions: crawlOptions
      });

      // Prepare discovery options
      const discoveryOptions: DiscoveryOptions = {
        url,
        maxUrls,
        includeSubdomains,
        searchQuery,
        skipSitemaps,
        sitemapsOnly,
        useUrlIndex,
        timeoutMs,
        includePatterns,
        excludePatterns,
        rateLimitingOptions,
        crawlOptions
      };

      // Run URL discovery with timeout wrapper to prevent hanging
      const discoveryTimeoutMs = timeoutMs || 30000; // Use user-provided timeout or default to 30 seconds
      
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Discovery timeout after ${discoveryTimeoutMs}ms`)), discoveryTimeoutMs)
      );

      const discoveryResult = await Promise.race([
        this.discoveryService.discoverUrls(discoveryOptions),
        timeoutPromise
      ]);

      // Prepare response
      const response: MapResponse = {
        success: true,
        data: discoveryResult,
        metadata: {
          url,
          includeSubdomains,
          maxUrls,
          timestamp: new Date().toISOString()
        }
      };

      const totalTime = Date.now() - startTime;
      logger.info('URL discovery completed successfully', {
        url,
        totalUrls: discoveryResult.total,
        timeTaken: totalTime,
        fromCache: discoveryResult.fromCache,
        methods: discoveryResult.discoveryMethods
      });

      res.status(200).json(response);

    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('URL discovery failed', {
        url: req.body?.url,
        error: errorMessage,
        timeTaken: totalTime,
        stack: error instanceof Error ? error.stack : undefined
      });

      const response: MapResponse = {
        success: false,
        data: {
          links: [],
          total: 0,
          discoveryMethods: {
            sitemap: 0,
            search: 0,
            crawling: 0,
            commonPaths: 0,
            robotsSitemaps: 0,
            documents: 0
          },
          timeTaken: totalTime,
          fromCache: false
        },
        metadata: {
          url: req.body?.url || '',
          includeSubdomains: req.body?.includeSubdomains ?? true,
          maxUrls: req.body?.maxUrls ?? 5000,
          timestamp: new Date().toISOString()
        },
        error: errorMessage
      };

      // Return appropriate status code based on error type
      const statusCode = errorMessage.includes('Invalid') || errorMessage.includes('required') ? 400 : 500;
      res.status(statusCode).json(response);
    }
  }

  /**
   * Get discovery cache statistics
   */
  async getCacheStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await this.discoveryService.getCacheStats();
      
      res.status(200).json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Failed to get cache stats', {
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cache statistics'
      });
    }
  }

  /**
   * Clear discovery cache for a specific URL
   */
  async clearCache(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;

      if (!url) {
        res.status(400).json({
          success: false,
          error: 'URL is required'
        });
        return;
      }

      await this.discoveryService.clearCache(url);

      logger.info('Discovery cache cleared', { url });

      res.status(200).json({
        success: true,
        message: 'Cache cleared successfully'
      });

    } catch (error) {
      logger.error('Failed to clear cache', {
        url: req.body?.url,
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to clear cache'
      });
    }
  }

  /**
   * Health check for the map service
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      // Basic health check - verify service dependencies
      const stats = await this.discoveryService.getCacheStats();
      
      res.status(200).json({
        success: true,
        status: 'healthy',
        services: {
          cache: 'operational',
          discovery: 'operational'
        },
        cacheStats: stats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Map service health check failed', {
        error: (error as Error).message
      });

      res.status(503).json({
        success: false,
        status: 'unhealthy',
        error: 'Service dependencies unavailable'
      });
    }
  }
}