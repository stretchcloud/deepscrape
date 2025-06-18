import { Request, Response } from 'express';
import { z } from 'zod';
import { ScraperManager } from '../../scraper/scraper-manager';
import { ApiResponse, ScrapeRequest, ScraperOptions } from '../../types';
import { logger } from '../../utils/logger';

// Initialize scraper manager
const scraperManager = new ScraperManager();

// Validation schema for scrape request
const scrapeRequestSchema = z.object({
  url: z.string().url().nonempty(),
  options: z.object({
    timeout: z.number().positive().optional(),
    blockAds: z.boolean().optional(),
    blockResources: z.boolean().optional(),
    userAgent: z.string().optional(),
    proxy: z.string().optional(),
    cookies: z.record(z.string()).optional(),
    headers: z.record(z.string()).optional(),
    waitForSelector: z.string().optional(),
    fullPage: z.boolean().optional(),
    javascript: z.boolean().optional(),
    extractorFormat: z.enum(['html', 'markdown', 'text']).optional(),
  }).optional(),
}).strict();

/**
 * Handle scrape request
 */
export const scrapeUrl = async (req: Request, res: Response) => {
  try {
    logger.info(`Received scrape request: ${JSON.stringify(req.body)}`);
    
    // Validate request body
    const validationResult = scrapeRequestSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      logger.warn(`Validation error: ${JSON.stringify(validationResult.error)}`);
      
      const response: ApiResponse<null> = {
        success: false,
        error: 'Validation error: ' + JSON.stringify(validationResult.error.errors)
      };
      
      return res.status(400).json(response);
    }
    
    const { url, options = {} } = validationResult.data;
    
    // Process the request synchronously
    logger.info(`Processing scrape request for URL: ${url}`);
    const result = await scraperManager.scrape(url, options);
    
    // Check if there was an error during scraping
    if (result.error) {
      logger.error(`Error scraping URL ${url}: ${result.error}`);
      
      const response: ApiResponse<null> = {
        success: false,
        error: result.error
      };
      
      return res.status(500).json(response);
    }
    
    // Send successful response
    const response: ApiResponse<typeof result> = {
      success: true,
      data: result
    };
    
    logger.info(`Successfully processed scrape request for URL: ${url}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Unexpected error processing scrape request: ${error instanceof Error ? error.message : String(error)}`);
    
    const response: ApiResponse<null> = {
      success: false,
      error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    };
    
    return res.status(500).json(response);
  }
}; 