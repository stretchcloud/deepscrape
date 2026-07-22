import { Router, Request, Response } from 'express';
import scraperManager from '../../scraper/scraper-manager';
import { logger } from '../../utils/logger';
import { apiKeyAuth as auth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter, statusLimiter } from '../middleware/rate-limit.middleware';
import { createTask, getTask } from '../../services/task.service';
import { ExtractionResult } from '../../types/schema';
import { scrapeRequestSchema, extractSchemaRequestSchema, summarizeRequestSchema, cacheInvalidateSchema } from '../schemas';

// Extended ScraperResponse interface to include extraction results
interface ExtendedScraperResponse {
  url: string;
  title: string;
  content: string;
  contentType: 'html' | 'markdown' | 'text';
  metadata: {
    timestamp: string;
    status: number;
    headers: Record<string, string>;
    processingTime?: number;
    loadTime?: number;
    cacheTtl?: number;
    cachedAt?: string;
    fromCache?: boolean;
    [key: string]: any;
  };
  screenshot?: Buffer;
  error?: string;
  extractedData?: any;
  structuredData?: any;
  extractionResult?: ExtractionResult<any>;
}

const router = Router();

// Browser action schema
/**
 * @route POST /api/scrape/async
 * @desc Submit a scrape as an async job (returns a job id to poll)
 * @access Private (requires API key authentication)
 */
router.post('/scrape/async', expensiveLimiter, auth, async (req: Request, res: Response) => {
  try {
    const { url, options } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'url is required' });
    }
    const id = await createTask('scrape', { url, options });
    const base = `${req.secure ? 'https' : 'http'}://${req.get('host')}`;
    return res.status(200).json({ success: true, id, url: `${base}/api/scrape/job/${id}`, status: 'pending' });
  } catch (error) {
    logger.error(`Failed to create scrape job: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to create scrape job' });
  }
});

/**
 * @route GET /api/scrape/job/:id
 * @desc Poll an async scrape job
 * @access Private (requires API key authentication)
 */
router.get('/scrape/job/:id', statusLimiter, auth, async (req: Request, res: Response) => {
  const task = await getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  return res.json({ success: true, ...task });
});

/**
 * @route POST /api/scrape
 * @desc Scrape a URL and return the content
 * @access Private (requires API key authentication)
 */
router.post(
  '/scrape',
  expensiveLimiter,
  auth,
  validateRequest(
    scrapeRequestSchema
  ),
  async (req: Request, res: Response) => {
    try {
      const { url, options = {} } = req.body;
      
      logger.info(`API request received to scrape URL: ${url}`);
      const startTime = Date.now();
      
      const response = await scraperManager.scrape(url, options);
      const processingTime = Date.now() - startTime;
      
      if (response.error) {
        logger.error(`Error scraping URL ${url}: ${response.error}`);
        return res.status(400).json({
          success: false,
          error: response.error,
          url,
          metadata: {
            processingTime,
            fromCache: response.metadata?.fromCache || false
          }
        });
      }
      
      const extended = response as ExtendedScraperResponse;
      return res.json({
        success: true,
        url: response.url,
        title: response.title || "",
        content: response.content,
        contentType: response.contentType,
        // Multi-format output when requested.
        ...((response as { formats?: Record<string, any> }).formats !== undefined ? { formats: (response as { formats?: Record<string, any> }).formats } : {}),
        ...((response as { jsResult?: any }).jsResult !== undefined ? { jsResult: (response as { jsResult?: any }).jsResult } : {}),
        // Include extraction output when present (CSS or LLM extraction).
        ...(extended.structuredData !== undefined ? { structuredData: extended.structuredData } : {}),
        ...(extended.extractionResult !== undefined ? { extractionResult: extended.extractionResult } : {}),
        metadata: {
          ...response.metadata,
          processingTime
        }
      });
    } catch (error) {
      logger.error(`Unexpected error in scrape route: ${error instanceof Error ? error.message : String(error)}`);
      
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/extract-schema
 * @desc Extract structured data from a URL using a schema
 * @access Private (requires API key authentication)
 */
router.post(
  '/extract-schema',
  expensiveLimiter,
  auth,
  validateRequest(
    extractSchemaRequestSchema
  ),
  async (req: Request, res: Response) => {
    try {
      const { url, schema, options = {} } = req.body;
      
      logger.info(`API request received to extract structured data from URL: ${url}`);
      const startTime = Date.now();

      // Combine options with extraction options and force markdown format
      const scrapingOptions = {
        ...options,
        extractorFormat: options.extractorFormat ?? 'markdown', // Default to markdown
        extractionOptions: {
          schema,
          instructions: options.instructions,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          extractionType: 'structured'
        }
      };
      
      const response = await scraperManager.scrape(url, scrapingOptions);
      const processingTime = Date.now() - startTime;
      
      if (response.error) {
        logger.error(`Error extracting schema from URL ${url}: ${response.error}`);
        return res.status(400).json({
          success: false,
          error: response.error,
          url,
          metadata: {
            processingTime,
            fromCache: response.metadata?.fromCache || false
          }
        });
      }
      
      // Cast response to access extended properties
      const extendedResponse = response as ExtendedScraperResponse;
      
      // If LLM extraction was not available, create a formatted response
      let formattedResponse = {};
      
      // Check for structured data from the API result
      if (extendedResponse.structuredData) {
        // Use the structured data directly from the LLM extraction result
        formattedResponse = extendedResponse.structuredData;
        logger.info('Using structured data from successful LLM extraction');
      } else if (extendedResponse.extractedData) {
        // Use extractedData if structuredData isn't available
        formattedResponse = extendedResponse.extractedData;
        logger.info('Using extractedData from response');
      } else if (extendedResponse.content) {
        // Fallback to basic data if no extraction was performed
        formattedResponse = {
          url: extendedResponse.url,
          title: extendedResponse.title || "No title available",
          contentPreview: extendedResponse.content.substring(0, 500) + "..."
        };
        logger.warn('No structured data available, using basic content preview');
      }
      
      // Format the response with proper markdown
      const markdownContent = formatResponseAsMarkdown(
        extendedResponse.url, 
        extendedResponse.title, 
        schema, 
        formattedResponse,
        null // No warning message
      );
      
      // If format is markdown, return the formatted markdown directly as extractedData
      const responseData = options.extractorFormat === 'markdown' 
        ? markdownContent 
        : formattedResponse;
      
      return res.json({
        success: true,
        url: extendedResponse.url,
        title: extendedResponse.title,
        extractedData: responseData,
        contentType: 'markdown',  // Specify content type as markdown
        metadata: {
          ...extendedResponse.metadata,
          processingTime
        }
        // No warning message
      });
    } catch (error) {
      logger.error(`Unexpected error in schema extraction route: ${error instanceof Error ? error.message : String(error)}`);
      
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * Format a header section with title and URL
 */
function formatMarkdownHeader(url: string, title: string, warningMessage: string | null): string {
  let markdown = `# ${title || 'Extracted Content'}\n\n`;
  markdown += `URL: ${url}\n\n`;
  
  if (warningMessage) {
    markdown += `> ⚠️ **Note**: ${warningMessage}\n\n`;
  }
  
  return markdown;
}

/**
 * Format code examples as markdown code blocks
 */
function formatCodeExamples(value: any[]): string {
  let markdown = '';
  value.forEach((item, index) => {
    markdown += `#### Example ${index + 1}\n\n`;
    markdown += '```typescript\n' + item + '\n```\n\n';
  });
  return markdown;
}

/**
 * Format array of objects as nested markdown structure
 */
function formatObjectArray(value: any[]): string {
  let markdown = '';
  value.forEach((item, index) => {
    markdown += `#### Item ${index + 1}\n\n`;
    for (const [objKey, objValue] of Object.entries(item)) {
      markdown += `**${objKey.charAt(0).toUpperCase() + objKey.slice(1)}**:\n`;
      if (Array.isArray(objValue)) {
        objValue.forEach(v => markdown += `- ${v}\n`);
      } else {
        markdown += `${objValue}\n`;
      }
      markdown += '\n';
    }
  });
  return markdown;
}

/**
 * Format simple array as bullet list
 */
function formatSimpleArray(value: any[]): string {
  let markdown = '';
  value.forEach(item => {
    markdown += `- ${item}\n`;
  });
  return markdown + '\n';
}

/**
 * Format a single field value based on its type
 */
function formatFieldValue(key: string, value: any): string {
  if (value === null || value === undefined) {
    return '*No data available*\n\n';
  }
  
  if (Array.isArray(value)) {
    const isCodeField = key.toLowerCase().includes('code') || key.toLowerCase().includes('example');
    if (isCodeField) {
      return formatCodeExamples(value);
    }
    if (value.length > 0 && typeof value[0] === 'object') {
      return formatObjectArray(value);
    }
    return formatSimpleArray(value);
  }
  
  if (typeof value === 'object') {
    return '```json\n' + JSON.stringify(value, null, 2) + '\n```\n\n';
  }
  
  return `${value}\n\n`;
}

/**
 * Format extracted data as Markdown
 */
function formatResponseAsMarkdown(
  url: string,
  title: string,
  schema: any,
  extractedData: any,
  warningMessage: string | null
): string {
  let markdown = formatMarkdownHeader(url, title, warningMessage);
  markdown += `## Extracted Data\n\n`;
  
  if (Object.keys(extractedData).length > 0) {
    for (const [key, value] of Object.entries(extractedData)) {
      markdown += `### ${key.charAt(0).toUpperCase() + key.slice(1)}\n\n`;
      markdown += formatFieldValue(key, value);
    }
  } else {
    markdown += "*No data could be extracted. Try enabling LLM extraction with OpenAI credentials.*\n\n";
  }
  
  return markdown;
}

/**
 * @route POST /api/summarize
 * @desc Summarize the content of a URL
 * @access Private (requires API key authentication)
 */
router.post(
  '/summarize',
  expensiveLimiter,
  auth,
  validateRequest(
    summarizeRequestSchema
  ),
  async (req: Request, res: Response) => {
    try {
      const { url, maxLength = 500, options = {} } = req.body;
      
      logger.info(`API request received to summarize URL: ${url}`);
      const startTime = Date.now();
      
      // Create summary extraction options
      const scrapingOptions = {
        ...options,
        extractorFormat: options.extractorFormat ?? 'markdown',
        extractionOptions: {
          instructions: `Provide a concise summary of the content in about ${maxLength} words.
            Focus on the main points and key information.`,
          temperature: options.temperature ?? 0.3,
          maxTokens: maxLength * 2, // Approximation for token limit
          extractionType: 'summarize'
        }
      };
      
      const response = await scraperManager.scrape(url, scrapingOptions);
      const processingTime = Date.now() - startTime;
      
      if (response.error) {
        logger.error(`Error summarizing URL ${url}: ${response.error}`);
        return res.status(400).json({
          success: false,
          error: response.error,
          url,
          metadata: {
            processingTime,
            fromCache: response.metadata?.fromCache || false
          }
        });
      }
      
      // Cast response to access extended properties
      const extendedResponse = response as ExtendedScraperResponse;
      
      // Log response details for debugging
      logger.info(`Response data fields: ${Object.keys(response).join(', ')}`);
      logger.info(`Response structuredData: ${extendedResponse.structuredData ? 'present' : 'missing'}`);
      logger.info(`Response extractedData: ${extendedResponse.extractedData ? 'present' : 'missing'}`);
      
      // Choose the best available data field for summary
      let summaryContent = null;
      
      if (extendedResponse.structuredData?.summary) {
        summaryContent = extendedResponse.structuredData.summary;
        logger.info('Using structuredData.summary');
      } else if (extendedResponse.structuredData) {
        summaryContent = extendedResponse.structuredData;
        logger.info('Using structuredData');
      } else if (extendedResponse.extractedData?.summary) {
        summaryContent = extendedResponse.extractedData.summary;
        logger.info('Using extractedData.summary');
      } else if (extendedResponse.extractedData) {
        summaryContent = extendedResponse.extractedData;
        logger.info('Using extractedData');
      } else if (extendedResponse.content) {
        // Generate a simple fallback summary from content
        const contentPreview = extendedResponse.content.substring(0, 500);
        summaryContent = `${extendedResponse.title}\n\n${contentPreview}...`;
        logger.warn('No structured summary available, using content preview');
      }
      
      return res.json({
        success: true,
        url: extendedResponse.url,
        title: extendedResponse.title,
        summary: summaryContent,
        metadata: {
          ...extendedResponse.metadata,
          processingTime
        }
      });
    } catch (error) {
      logger.error(`Unexpected error in summarize route: ${error instanceof Error ? error.message : String(error)}`);
      
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route DELETE /api/cache
 * @desc Clear the entire cache or invalidate a specific URL
 * @access Private (requires API key authentication)
 */
router.delete(
  '/cache',
  auth,
  validateRequest(
    cacheInvalidateSchema
  ),
  async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      
      if (url) {
        logger.info(`API request received to invalidate cache for URL: ${url}`);
        await scraperManager.invalidateCache(url);
        return res.json({
          success: true,
          message: `Cache invalidated for URL: ${url}`
        });
      } else {
        logger.info('API request received to clear entire cache');
        await scraperManager.clearCache();
        return res.json({
          success: true,
          message: 'Cache cleared'
        });
      }
    } catch (error) {
      logger.error(`Unexpected error in cache route: ${error instanceof Error ? error.message : String(error)}`);
      
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router; 