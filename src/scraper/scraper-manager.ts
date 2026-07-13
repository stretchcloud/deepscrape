import { ScraperOptions, ScraperResponse, BrowserAction } from '../types';
import { PlaywrightScraper } from './playwright-scraper';
import { HttpScraper } from './http-scraper';
import { ContentCleaner } from '../transformers/content-cleaner';
import { HtmlToMarkdownTransformer } from '../transformers/html-to-markdown';
import { LLMExtractor } from '../transformers/llm-extractor';
import { extractWithCssSchema } from '../transformers/css-extractor';
import { pruneToFitHtml } from '../transformers/content-filter';
import { extractTables } from '../transformers/table-extractor';
import { extractContacts } from '../transformers/contact-extractor';
import { computeChange } from '../services/change-tracking.service';
import { extractChildLinks } from './crawl-links';
import { LLMServiceFactory } from '../services/llm-service-factory';
import { CacheService } from '../services/cache.service';
import { ExtractionOptions } from '../types/schema';
import { logger } from '../utils/logger';
import { assertPublicUrl, SsrfError } from '../utils/ssrf-guard';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

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
  private generateCacheKey(
    url: string,
    options: ScraperOptions & { extractionOptions?: ExtractionOptions }
  ): string {
    // The cache key MUST incorporate every option that changes the produced
    // result, otherwise two different requests to the same URL can collide and
    // return each other's data (e.g. different LLM extraction schemas).
    const cacheableOptions = {
      extractorFormat: options.extractorFormat,
      waitForSelector: options.waitForSelector,
      actions: options.actions,
      useBrowser: options.useBrowser,
      onlyMainContent: options.onlyMainContent,
      fitMarkdown: options.fitMarkdown,
      waitForTimeout: options.waitForTimeout,
      stealthMode: options.stealthMode,
      skipTlsVerification: options.skipTlsVerification,
      headers: options.headers,
      // Extraction changes the output shape entirely — include it in full
      // (cssSchema included so different extraction schemas never collide).
      extraction: options.extractionOptions
        ? {
            type: options.extractionOptions.extractionType,
            schema: options.extractionOptions.schema,
            cssSchema: options.extractionOptions.cssSchema,
            instructions: options.extractionOptions.instructions,
            promptFormat: options.extractionOptions.promptFormat,
            exampleData: options.extractionOptions.exampleData
          }
        : undefined
    };

    const hash = createHash('sha256')
      .update(JSON.stringify(cacheableOptions))
      .digest('hex')
      .slice(0, 32);
    return `${url}:${hash}`;
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
    // Fast path: for server-rendered sites, the HTTP (axios) scraper is ~10x
    // faster than launching a browser. Try it first when requested and only fall
    // back to Playwright if it errors or returns empty content.
    if (options.preferHttpScraper && !options.useBrowser) {
      const httpResponse = await this.httpScraper.scrape(url, options);
      if (!httpResponse.error && httpResponse.content && httpResponse.content.trim().length > 200) {
        return httpResponse;
      }
      logger.info(`HTTP scrape thin/failed for ${url}, falling back to Playwright`);
    }

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
      // Honor onlyMainContent (default true). false = keep the full page.
      // fitMarkdown (default true) uses the pruning content filter for fidelity.
      processedResponse = this.convertToMarkdown(
        cleanedResponse,
        options.onlyMainContent !== false,
        options.fitMarkdown !== false
      );
    } else if (options.extractorFormat === 'text') {
      processedResponse = this.extractTextOnly(cleanedResponse);
    }

    return processedResponse;
  }

  /**
   * Convert content to markdown format
   */
  private convertToMarkdown(response: ScraperResponse, onlyMainContent = true, fitMarkdown = true): ScraperResponse {
    logger.info('Converting HTML to Markdown');

    if (response.contentType !== 'html') {
      logger.warn(`Content type is not HTML (${response.contentType}), forcing conversion to HTML`);
      response.contentType = 'html';
    }

    if (!response.content || response.content.trim() === '') {
      logger.warn('Content is empty, cannot convert to Markdown');
      return response;
    }

    const processedResponse = this.markdownTransformer.transform(response, onlyMainContent, fitMarkdown);
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
      // Surface *why* extraction didn't run so callers (e.g. /api/extract sources)
      // report a concrete reason instead of a silent success:false.
      return {
        ...processedResponse,
        extractionResult: {
          success: false,
          error: 'LLM extractor not configured (set OPENAI_API_KEY or an LLM provider)',
        },
      };
    }
  }

  /**
   * Apply deterministic CSS-selector extraction (no LLM). Runs against the raw
   * HTML so selectors match the real document, not the transformed markdown.
   */
  private applyCssExtraction(
    processedResponse: ScraperResponse,
    rawHtml: string | null,
    extractionOptions: ExtractionOptions
  ): ScraperResponse {
    const start = Date.now();
    const html = rawHtml || (processedResponse.contentType === 'html' ? processedResponse.content : '');
    if (!html || !extractionOptions.cssSchema) {
      return processedResponse;
    }
    try {
      const records = extractWithCssSchema(html, extractionOptions.cssSchema);
      logger.info(`CSS extraction produced ${records.length} record(s) in ${Date.now() - start}ms`);
      return {
        ...processedResponse,
        structuredData: records,
        extractionResult: {
          success: true,
          data: records as any,
          metadata: { extractionTime: Date.now() - start, modelName: 'css-selector' }
        }
      };
    } catch (error) {
      logger.error(`CSS extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        ...processedResponse,
        extractionResult: { success: false, error: `CSS extraction error: ${(error as Error).message}` }
      };
    }
  }

  /**
   * Build the requested output formats from the raw HTML in a single pass, so a
   * caller can get markdown + html + links + screenshot etc. without N requests.
   */
  private buildRequestedFormats(
    url: string,
    rawHtml: string | null,
    rawScrape: ScraperResponse,
    options: ScraperOptions
  ): Record<string, any> {
    const formats: Record<string, any> = {};
    const requested = new Set((options.formats || []).map(f => f.toLowerCase()));
    const html = rawHtml || (rawScrape.contentType === 'html' ? rawScrape.content : '') || '';
    const onlyMain = options.onlyMainContent !== false;
    const fit = options.fitMarkdown !== false;

    for (const fmt of requested) {
      try {
        switch (fmt) {
          case 'rawhtml':
            formats.rawHtml = html;
            break;
          case 'html':
            formats.html = fit && onlyMain
              ? pruneToFitHtml(html, { preserveTags: ['pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'] })
              : html;
            break;
          case 'markdown':
            formats.markdown = this.markdownTransformer.transform(
              { ...rawScrape, content: html, contentType: 'html' },
              onlyMain,
              fit
            ).content;
            break;
          case 'text':
            formats.text = cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
            break;
          case 'links':
            formats.links = extractChildLinks(html, url);
            break;
          case 'screenshot':
            formats.screenshot = rawScrape.screenshot
              ? `data:image/png;base64,${rawScrape.screenshot.toString('base64')}`
              : null;
            break;
          case 'pdf':
            formats.pdf = rawScrape.pdf
              ? `data:application/pdf;base64,${rawScrape.pdf.toString('base64')}`
              : null;
            break;
          case 'mhtml':
            formats.mhtml = rawScrape.mhtml ?? null;
            break;
          case 'tables':
            formats.tables = extractTables(html);
            break;
          case 'contacts':
            formats.contacts = extractContacts(html, url);
            break;
          default:
            logger.warn(`Unknown format requested: ${fmt}`);
        }
      } catch (err) {
        logger.warn(`Failed to build format '${fmt}' for ${url}: ${(err as Error).message}`);
      }
    }
    return formats;
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

      // SSRF pre-flight: reject private/loopback/metadata targets before any I/O.
      try {
        await assertPublicUrl(url);
      } catch (guardError) {
        if (guardError instanceof SsrfError) {
          logger.warn(`Scrape blocked by SSRF guard: ${guardError.message}`);
          return {
            url,
            title: '',
            content: '',
            contentType: 'html',
            metadata: { timestamp: new Date().toISOString(), status: 0, headers: {}, processingTime: Date.now() - startTime },
            error: 'Blocked: target URL resolves to a non-public address'
          };
        }
        throw guardError;
      }

      // Multi-format requests (and JS execution) bypass the cache — formats are
      // derived post-cache and can be large/binary, and JS results are dynamic.
      const multiFormat = Array.isArray(options.formats) && options.formats.length > 0;
      if (multiFormat || options.executeJs) {
        options.skipCache = true;
      }

      // screenshot/pdf/mhtml capture and JS execution require the per-request
      // Playwright path (extractPageData captures them) — NOT the pooled useBrowser
      // path. Force the browser + the relevant capture flags, disable the HTTP fast
      // path, and leave useBrowser off.
      const fmts = multiFormat ? options.formats!.map(f => f.toLowerCase()) : [];
      const wantScreenshot = fmts.includes('screenshot');
      const wantPdf = fmts.includes('pdf');
      const wantMhtml = fmts.includes('mhtml');
      if (wantScreenshot || wantPdf || wantMhtml || options.executeJs) {
        options.preferHttpScraper = false;
        options.useBrowser = false;
        if (wantScreenshot) options.fullPage = true;
        if (wantPdf) options.capturePdf = true;
        if (wantMhtml) options.captureMhtml = true;
      }

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

      // Capture the raw HTML before cleaning/transformation for callers that need
      // it (e.g. crawl link discovery), so they don't have to re-fetch the page.
      const rawHtml = scraperResponse.contentType === 'html' ? scraperResponse.content : null;

      // Clean content
      const cleanedResponse = this.cleanHtmlContent(scraperResponse);
      if (cleanedResponse.error && !scraperResponse.error) {
        return cleanedResponse;
      }

      // Apply transformations
      let processedResponse = this.applyContentTransformations(cleanedResponse, options);

      // Apply extraction: deterministic CSS (no LLM) takes precedence, else LLM.
      if (options.extractionOptions?.cssSchema) {
        processedResponse = this.applyCssExtraction(processedResponse, rawHtml, options.extractionOptions);
      } else if (options.extractionOptions) {
        processedResponse = await this.applyLLMExtraction<T>(processedResponse, options);
      }

      // Finalize and cache
      const finalResponse = await this.finalizeResponse(processedResponse, url, startTime, cacheKey, options);

      // Attach raw HTML AFTER caching so we don't bloat the cache; callers that
      // set includeRawHtml (crawl discovery) get it on fresh scrapes.
      if (options.includeRawHtml && rawHtml) {
        (finalResponse as ScraperResponse & { rawHtml?: string }).rawHtml = rawHtml;
      }

      // Multi-format output: derive every requested format from the raw HTML in
      // one request (markdown/html/rawHtml/text/links/screenshot/pdf/mhtml/tables).
      if (Array.isArray(options.formats) && options.formats.length > 0) {
        finalResponse.formats = this.buildRequestedFormats(url, rawHtml, scraperResponse, options);

        // Change tracking: diff the main-content markdown against the last snapshot.
        const fmtSet = new Set(options.formats.map(f => f.toLowerCase()));
        if (fmtSet.has('changetracking') || fmtSet.has('change-tracking')) {
          const md: string = finalResponse.formats.markdown
            ?? this.markdownTransformer.transform(
                 { ...scraperResponse, content: rawHtml || scraperResponse.content, contentType: 'html' },
                 options.onlyMainContent !== false,
                 options.fitMarkdown !== false
               ).content;
          const fp = `${options.onlyMainContent !== false}|${options.fitMarkdown !== false}`;
          finalResponse.formats.changeTracking = await computeChange(url, fp, md || '');
        }
      }
      // Surface arbitrary-JS execution result.
      if (options.executeJs && scraperResponse.jsResult !== undefined) {
        finalResponse.jsResult = scraperResponse.jsResult;
      }
      return finalResponse;

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

      // Use a safe approach to strip HTML tags to prevent ReDoS attacks
      let textContent = '';
      try {
        // Use cheerio for safe HTML parsing and text extraction (more secure than regex)
        const $ = cheerio.load(scraperResponse.content);
        textContent = $.text();
      } catch (cheerioError) {
        // Log the error for debugging and monitoring purposes
        logger.warn('Cheerio failed to parse HTML content, falling back to regex approach', {
          error: (cheerioError as Error).message,
          contentLength: scraperResponse.content?.length || 0
        });

        // Fallback to a safer regex approach if cheerio fails
        // This regex is safer as it limits the length and avoids catastrophic backtracking
        textContent = scraperResponse.content
          .replace(/<[^>]{0,1000}>/g, ' ') // Limit tag length to prevent ReDoS
          .replace(/\s+/g, ' ');           // Replace multiple spaces with single space
      }

      textContent = textContent.trim(); // Trim extra spaces

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
