import { ScraperOptions, ScraperResponse, BrowserAction } from '../types';
import { PlaywrightScraper } from './playwright-scraper';
import { HttpScraper } from './http-scraper';
import { ContentCleaner } from '../transformers/content-cleaner';
import { HtmlToMarkdownTransformer } from '../transformers/html-to-markdown';
import { LLMExtractor } from '../transformers/llm-extractor';
import { LLMServiceFactory } from '../services/llm-service-factory';
import { CacheService } from '../services/cache.service';
import { ExtractionOptions } from '../types/schema';
import { logger } from '../utils/logger';

export class ScraperManager {
  private readonly playwriteScraper: PlaywrightScraper;
  private readonly httpScraper: HttpScraper;
  private readonly contentCleaner: ContentCleaner;
  private readonly markdownTransformer: HtmlToMarkdownTransformer;
  private llmExtractor: LLMExtractor | null = null;
  private readonly cacheService: CacheService;

  constructor() {
    this.playwriteScraper = new PlaywrightScraper();
    this.httpScraper = new HttpScraper();
    this.contentCleaner = new ContentCleaner();
    this.markdownTransformer = new HtmlToMarkdownTransformer();
    
    // Initialize cache service
    this.cacheService = new CacheService({
      enabled: process.env.CACHE_ENABLED === 'true',
      ttl: Number(process.env.CACHE_TTL || 3600),
      directory: process.env.CACHE_DIRECTORY || './cache'
    });
    
    // LLM extractor will be initialized lazily or explicitly
    this.llmExtractor = null;
  }

  /**
   * Generate a unique cache key for a scrape request
   */
  private generateCacheKey(url: string, options: ScraperOptions): string {
    // Create a simplified version of options for the cache key
    const cacheableOptions = {
      extractorFormat: options.extractorFormat,
      waitForSelector: options.waitForSelector,
      actions: options.actions
    };
    
    return `${url}:${JSON.stringify(cacheableOptions)}`;
  }

  /**
   * Initialize the ScraperManager - must be called before using
   */
  public async initialize(): Promise<void> {
    await this.initializeLLMExtractor();
  }

  /**
   * Initialize LLM extractor with GPT-4o model
   */
  private async initializeLLMExtractor(): Promise<void> {
    try {
      // Get the appropriate LLM service
      const llmService = LLMServiceFactory.createLLMService();
      
      if (!llmService) {
        logger.warn('Failed to initialize LLM service for extraction');
        return;
      }
      
      this.llmExtractor = new LLMExtractor(llmService);
      logger.info('LLM extractor initialized successfully');
    } catch (error) {
      logger.error(`Error initializing LLM extractor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Ensure LLM extractor is initialized (lazy initialization)
   */
  private async ensureLLMExtractor(): Promise<void> {
    if (!this.llmExtractor) {
      await this.initializeLLMExtractor();
    }
  }

  /**
   * Scrape a URL and apply transformations based on options
   */
  /**
   * Check cache for existing response
   */
  private async checkCache(cacheKey: string, url: string, skipCache: boolean): Promise<ScraperResponse | null> {
    if (skipCache) {
      return null;
    }
    
    const cachedResponse = await this.cacheService.get<ScraperResponse>(cacheKey);
    if (cachedResponse) {
      logger.info(`Retrieved from cache: ${url}`);
    }
    return cachedResponse;
  }

  /**
   * Get raw content using scrapers with fallback
   */
  private async getRawContent(url: string, options: ScraperOptions): Promise<ScraperResponse> {
    let scraperResponse = await this.playwriteScraper.scrape(url, options);
    
    // Try HTTP scraper as fallback if Playwright fails
    if (scraperResponse.error?.includes('browserType.launch')) {
      logger.warn(`Playwright failed, falling back to HTTP scraper: ${scraperResponse.error}`);
      scraperResponse = await this.httpScraper.scrape(url, options);
      
      if (!scraperResponse.error) {
        logger.info('HTTP scraper fallback successful');
      }
    }
    
    return scraperResponse;
  }

  /**
   * Clean HTML content
   */
  private cleanHtmlContent(scraperResponse: ScraperResponse): ScraperResponse {
    const cleanedResponse = this.contentCleaner.clean(scraperResponse);
    
    if (cleanedResponse.error && !scraperResponse.error) {
      logger.error(`Error occurred during content cleaning: ${cleanedResponse.error}`);
    }
    
    return cleanedResponse;
  }

  /**
   * Apply content transformations based on options
   */
  private applyContentTransformations(cleanedResponse: ScraperResponse, options: ScraperOptions): ScraperResponse {
    let processedResponse = cleanedResponse;
    
    logger.info(`Processing response. Content type: ${cleanedResponse.contentType}, Extractor format: ${options.extractorFormat}`);

    if (options.extractorFormat === 'markdown') {
      processedResponse = this.convertToMarkdown(cleanedResponse);
    } else if (options.extractorFormat === 'text') {
      processedResponse = this.extractTextOnly(cleanedResponse);
    }
    
    return processedResponse;
  }

  /**
   * Convert content to markdown format
   */
  private convertToMarkdown(response: ScraperResponse): ScraperResponse {
    logger.info('Converting HTML to Markdown');
    
    if (response.contentType !== 'html') {
      logger.warn(`Content type is not HTML (${response.contentType}), forcing conversion to HTML`);
      response.contentType = 'html';
    }
    
    if (!response.content || response.content.trim() === '') {
      logger.warn('Content is empty, cannot convert to Markdown');
      return response;
    }
    
    const processedResponse = this.markdownTransformer.transform(response);
    logger.info(`Markdown conversion complete. Content length: ${processedResponse.content.length}`);
    return processedResponse;
  }

  /**
   * Apply LLM extraction if enabled
   */
  private async applyLLMExtraction<T>(
    processedResponse: ScraperResponse, 
    options: ScraperOptions & { extractionOptions?: ExtractionOptions }
  ): Promise<ScraperResponse> {
    if (!options.extractionOptions) {
      return processedResponse;
    }
    
    await this.ensureLLMExtractor();
    
    if (this.llmExtractor) {
      logger.info('Applying LLM extraction with schema');
      const extractionResult = await this.llmExtractor.extract<T>(
        processedResponse, 
        options.extractionOptions
      );
      return extractionResult;
    } else {
      logger.warn('Extraction options provided but LLM extractor failed to initialize');
      return processedResponse;
    }
  }

  /**
   * Finalize response with metadata and caching
   */
  private async finalizeResponse(
    processedResponse: ScraperResponse,
    url: string,
    startTime: number,
    cacheKey: string,
    options: ScraperOptions & { skipCache?: boolean; cacheTtl?: number }
  ): Promise<ScraperResponse> {
    // Add performance metrics
    processedResponse.metadata.processingTime = Date.now() - startTime;
    
    // Cache if no errors and caching enabled
    if (!processedResponse.error && !options.skipCache) {
      await this.cacheService.set(cacheKey, processedResponse, {
        url,
        contentType: processedResponse.contentType,
        customTtl: options.cacheTtl
      });
    }
    
    logger.info(`Scraping process completed successfully for URL: ${url} in ${Date.now() - startTime}ms`);
    return processedResponse;
  }

  /**
   * Create error response
   */
  private createErrorResponse(url: string, error: any, startTime: number): ScraperResponse {
    return {
      url,
      title: '',
      content: '',
      contentType: 'html',
      metadata: {
        timestamp: new Date().toISOString(),
        status: 0,
        headers: {},
        processingTime: Date.now() - startTime
      },
      error: `Scraping process error: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  async scrape<T = any>(url: string, options: ScraperOptions & { 
    extractionOptions?: ExtractionOptions;
    skipCache?: boolean;
    cacheTtl?: number; // Custom TTL in seconds
  } = {}): Promise<ScraperResponse> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(url, options);
    
    try {
      logger.info(`Starting scraping process for URL: ${url}`);
      
      // Check cache first
      const cachedResponse = await this.checkCache(cacheKey, url, options.skipCache || false);
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Get raw content with fallback
      const scraperResponse = await this.getRawContent(url, options);
      if (scraperResponse.error) {
        logger.error(`Error occurred during scraping: ${scraperResponse.error}`);
        return scraperResponse;
      }

      // Clean content
      const cleanedResponse = this.cleanHtmlContent(scraperResponse);
      if (cleanedResponse.error && !scraperResponse.error) {
        return cleanedResponse;
      }

      // Apply transformations
      let processedResponse = this.applyContentTransformations(cleanedResponse, options);
      
      // Apply LLM extraction
      processedResponse = await this.applyLLMExtraction<T>(processedResponse, options);
      
      // Finalize and cache
      return await this.finalizeResponse(processedResponse, url, startTime, cacheKey, options);
      
    } catch (error) {
      logger.error(`Unexpected error during scraping process: ${error instanceof Error ? error.message : String(error)}`);
      return this.createErrorResponse(url, error, startTime);
    }
  }

  /**
   * Close browser instances
   */
  async close(): Promise<void> {
    // This method is needed to properly close any Playwright instances
    logger.info('Closing Scraper Manager resources');
  }

  /**
   * Extract text only from HTML content
   */
  private extractTextOnly(scraperResponse: ScraperResponse): ScraperResponse {
    try {
      if (scraperResponse.contentType !== 'html' || !scraperResponse.content) {
        return scraperResponse;
      }

      // Use a simple regex to strip all HTML tags
      const textContent = scraperResponse.content
        .replace(/<[^>]*>/g, ' ') // Replace HTML tags with spaces
        .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
        .trim();                 // Trim extra spaces

      return {
        ...scraperResponse,
        content: textContent,
        contentType: 'text'
      };
    } catch (error) {
      logger.error(`Error extracting text: ${error instanceof Error ? error.message : String(error)}`);
      
      return {
        ...scraperResponse,
        error: `Text extraction error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Clear the cache
   */
  async clearCache(): Promise<void> {
    await this.cacheService.clear();
  }
  
  /**
   * Invalidate a specific URL in the cache
   */
  async invalidateCache(url: string): Promise<void> {
    await this.cacheService.invalidate(url);
  }
}

// Create singleton instance
const scraperManager = new ScraperManager();
export default scraperManager; 