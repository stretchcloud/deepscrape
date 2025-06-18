import axios from 'axios';
import { ScraperOptions, ScraperResponse } from '../types';
import { logger } from '../utils/logger';

/**
 * Simple HTTP-based scraper using axios (fallback when Playwright fails)
 */
export class HttpScraper {
  /**
   * Scrape a URL using HTTP requests
   */
  async scrape(url: string, options: ScraperOptions = {}): Promise<ScraperResponse> {
    const startTime = Date.now();
    
    try {
      logger.info(`HTTP scraping URL: ${url}`);
      
      const timeout = options.timeout ?? 30000;
      const userAgent = options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      
      const response = await axios.get(url, {
        timeout,
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          ...options.headers
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 400
      });
      
      const loadTime = Date.now() - startTime;
      
      // Extract title from HTML
      const titleMatch = response.data.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';
      
      logger.info(`HTTP scraping completed for ${url} in ${loadTime}ms`);
      
      return {
        url,
        title,
        content: response.data,
        contentType: 'html',
        metadata: {
          timestamp: new Date().toISOString(),
          status: response.status,
          headers: response.headers as Record<string, string>,
          loadTime
        }
      };
    } catch (error) {
      logger.error(`HTTP scraping error for ${url}: ${error instanceof Error ? error.message : String(error)}`);
      
      return {
        url,
        title: '',
        content: '',
        contentType: 'html',
        metadata: {
          timestamp: new Date().toISOString(),
          status: 0,
          headers: {}
        },
        error: `HTTP scraping error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
} 