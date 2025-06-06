"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScraperManager = void 0;
const playwright_scraper_1 = require("./playwright-scraper");
const http_scraper_1 = require("./http-scraper");
const content_cleaner_1 = require("../transformers/content-cleaner");
const html_to_markdown_1 = require("../transformers/html-to-markdown");
const llm_extractor_1 = require("../transformers/llm-extractor");
const llm_service_factory_1 = require("../services/llm-service-factory");
const cache_service_1 = require("../services/cache.service");
const logger_1 = require("../utils/logger");
class ScraperManager {
    constructor() {
        this.llmExtractor = null;
        this.playwriteScraper = new playwright_scraper_1.PlaywrightScraper();
        this.httpScraper = new http_scraper_1.HttpScraper();
        this.contentCleaner = new content_cleaner_1.ContentCleaner();
        this.markdownTransformer = new html_to_markdown_1.HtmlToMarkdownTransformer();
        // Initialize cache service
        this.cacheService = new cache_service_1.CacheService({
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
    generateCacheKey(url, options) {
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
    async initialize() {
        await this.initializeLLMExtractor();
    }
    /**
     * Initialize LLM extractor with GPT-4o model
     */
    async initializeLLMExtractor() {
        try {
            // Get the appropriate LLM service
            const llmService = llm_service_factory_1.LLMServiceFactory.createLLMService();
            if (!llmService) {
                logger_1.logger.warn('Failed to initialize LLM service for extraction');
                return;
            }
            this.llmExtractor = new llm_extractor_1.LLMExtractor(llmService);
            logger_1.logger.info('LLM extractor initialized successfully');
        }
        catch (error) {
            logger_1.logger.error(`Error initializing LLM extractor: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Ensure LLM extractor is initialized (lazy initialization)
     */
    async ensureLLMExtractor() {
        if (!this.llmExtractor) {
            await this.initializeLLMExtractor();
        }
    }
    /**
     * Scrape a URL and apply transformations based on options
     */
    async scrape(url, options = {}) {
        const startTime = Date.now();
        const cacheKey = this.generateCacheKey(url, options);
        try {
            logger_1.logger.info(`Starting scraping process for URL: ${url}`);
            // Check cache first unless skipCache is true
            if (!options.skipCache) {
                const cachedResponse = await this.cacheService.get(cacheKey);
                if (cachedResponse) {
                    logger_1.logger.info(`Retrieved from cache: ${url}`);
                    return cachedResponse;
                }
            }
            // Step 1: Get raw HTML using Playwright scraper (with HTTP fallback)
            let scraperResponse = await this.playwriteScraper.scrape(url, options);
            // If Playwright fails, try HTTP scraper as fallback
            if (scraperResponse.error?.includes('browserType.launch')) {
                logger_1.logger.warn(`Playwright failed, falling back to HTTP scraper: ${scraperResponse.error}`);
                scraperResponse = await this.httpScraper.scrape(url, options);
                if (!scraperResponse.error) {
                    logger_1.logger.info('HTTP scraper fallback successful');
                }
            }
            // If there was still an error, return immediately
            if (scraperResponse.error) {
                logger_1.logger.error(`Error occurred during scraping: ${scraperResponse.error}`);
                return scraperResponse;
            }
            // Step 2: Clean HTML content
            const cleanedResponse = this.contentCleaner.clean(scraperResponse);
            // If cleaning resulted in an error, return immediately
            if (cleanedResponse.error && !scraperResponse.error) {
                logger_1.logger.error(`Error occurred during content cleaning: ${cleanedResponse.error}`);
                return cleanedResponse;
            }
            // Step 3: Apply transformations based on options
            let processedResponse = cleanedResponse;
            // Debug logging for content type and extraction format
            logger_1.logger.info(`Processing response. Content type: ${cleanedResponse.contentType}, Extractor format: ${options.extractorFormat}`);
            // Convert to markdown if requested
            if (options.extractorFormat === 'markdown') {
                logger_1.logger.info('Converting HTML to Markdown');
                if (cleanedResponse.contentType !== 'html') {
                    logger_1.logger.warn(`Content type is not HTML (${cleanedResponse.contentType}), forcing conversion to HTML`);
                    cleanedResponse.contentType = 'html';
                }
                // Ensure content is not empty
                if (!cleanedResponse.content || cleanedResponse.content.trim() === '') {
                    logger_1.logger.warn('Content is empty, cannot convert to Markdown');
                }
                else {
                    processedResponse = this.markdownTransformer.transform(cleanedResponse);
                    logger_1.logger.info(`Markdown conversion complete. Content length: ${processedResponse.content.length}`);
                }
            }
            // Convert to text if requested (simple text extraction)
            else if (options.extractorFormat === 'text') {
                processedResponse = this.extractTextOnly(cleanedResponse);
            }
            // Step 4: Apply LLM extraction if requested
            if (options.extractionOptions) {
                await this.ensureLLMExtractor();
                if (this.llmExtractor) {
                    logger_1.logger.info('Applying LLM extraction with schema');
                    const extractionResult = await this.llmExtractor.extract(processedResponse, options.extractionOptions);
                    processedResponse = extractionResult;
                }
                else {
                    logger_1.logger.warn('Extraction options provided but LLM extractor failed to initialize');
                }
            }
            // Add performance metrics
            processedResponse.metadata.processingTime = Date.now() - startTime;
            // Store in cache if no errors occurred
            if (!processedResponse.error && !options.skipCache) {
                await this.cacheService.set(cacheKey, processedResponse, {
                    url,
                    contentType: processedResponse.contentType,
                    customTtl: options.cacheTtl
                });
            }
            logger_1.logger.info(`Scraping process completed successfully for URL: ${url} in ${Date.now() - startTime}ms`);
            return processedResponse;
        }
        catch (error) {
            logger_1.logger.error(`Unexpected error during scraping process: ${error instanceof Error ? error.message : String(error)}`);
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
    }
    /**
     * Close browser instances
     */
    async close() {
        // This method is needed to properly close any Playwright instances
        logger_1.logger.info('Closing Scraper Manager resources');
    }
    /**
     * Extract text only from HTML content
     */
    extractTextOnly(scraperResponse) {
        try {
            if (scraperResponse.contentType !== 'html' || !scraperResponse.content) {
                return scraperResponse;
            }
            // Use a simple regex to strip all HTML tags
            const textContent = scraperResponse.content
                .replace(/<[^>]*>/g, ' ') // Replace HTML tags with spaces
                .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                .trim(); // Trim extra spaces
            return {
                ...scraperResponse,
                content: textContent,
                contentType: 'text'
            };
        }
        catch (error) {
            logger_1.logger.error(`Error extracting text: ${error instanceof Error ? error.message : String(error)}`);
            return {
                ...scraperResponse,
                error: `Text extraction error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Clear the cache
     */
    async clearCache() {
        await this.cacheService.clear();
    }
    /**
     * Invalidate a specific URL in the cache
     */
    async invalidateCache(url) {
        await this.cacheService.invalidate(url);
    }
}
exports.ScraperManager = ScraperManager;
// Create singleton instance
const scraperManager = new ScraperManager();
exports.default = scraperManager;
