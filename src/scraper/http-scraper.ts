import axios from 'axios';
import { ScraperOptions, ScraperResponse } from '../types';
import { logger } from '../utils/logger';
import { assertPublicUrl, ssrfSafeRequestConfig, SsrfError } from '../utils/ssrf-guard';

/** Maximum response body size accepted from a fetched page (bytes). */
const MAX_RESPONSE_BYTES = Number(process.env.MAX_RESPONSE_BYTES ?? 10 * 1024 * 1024);

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

      // SSRF pre-flight: reject private/loopback/metadata targets before any I/O.
      await assertPublicUrl(url);

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
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        // SSRF-safe agents re-validate the resolved IP on every hop (incl. redirects).
        ...ssrfSafeRequestConfig(),
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
      if (error instanceof SsrfError) {
        logger.warn(`HTTP scraping blocked by SSRF guard for ${url}: ${error.message}`);
        return {
          url,
          title: '',
          content: '',
          contentType: 'html',
          metadata: { timestamp: new Date().toISOString(), status: 0, headers: {} },
          error: `Blocked: target resolves to a non-public address`
        };
      }
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
