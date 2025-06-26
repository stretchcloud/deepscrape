import axios from 'axios';
import { parseString } from 'xml2js';
import * as pako from 'pako';
import { logger } from '../utils/logger';
import { URLValidationUtils } from '../utils/url-validation.utils';
import { SitemapInfo } from '../types/discovery';

/**
 * Enhanced sitemap parsing service for URL discovery
 */
export class SitemapParserService {
  private readonly timeout: number;
  private readonly maxSitemapSize: number;
  private readonly userAgent: string;

  constructor() {
    this.timeout = 5000; // 5 seconds per sitemap
    this.maxSitemapSize = 50 * 1024 * 1024; // 50MB max
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  /**
   * Discover URLs from all sitemap sources
   */
  async discoverFromSitemaps(url: string, limit: number = 5000): Promise<string[]> {
    const startTime = Date.now();
    const allUrls: string[] = [];

    try {
      // 1. Get sitemap URLs from robots.txt
      const robotsSitemaps = await this.extractSitemapsFromRobots(url);
      logger.info(`Found ${robotsSitemaps.length} sitemaps in robots.txt`, { url });

      // 2. Try common sitemap locations
      const baseUrl = new URL(url).origin;
      const commonSitemapPaths = [
        '/sitemap.xml',
        '/sitemap_index.xml',
        '/sitemap.txt',
        '/sitemaps.xml',
        '/sitemap1.xml',
        '/xml_sitemap.xml',
        '/web_sitemap.xml'
      ];

      let potentialSitemaps = [
        ...robotsSitemaps,
        ...commonSitemapPaths.map(path => baseUrl + path)
      ];


      // 3. Parse sitemaps in smaller batches to avoid overwhelming the server
      const batchSize = 3; // Process 3 sitemaps at a time
      const sitemapResults: PromiseSettledResult<string[]>[] = [];
      
      for (let i = 0; i < potentialSitemaps.length; i += batchSize) {
        const batch = potentialSitemaps.slice(i, i + batchSize);
        const batchPromises = batch.map(async (sitemapUrl) => {
          try {
            return await this.parseSitemap(sitemapUrl);
          } catch (error) {
            logger.debug(`Failed to parse sitemap: ${sitemapUrl}`, {
              error: (error as Error).message
            });
            return [];
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        sitemapResults.push(...batchResults);
        
        // Add delay between batches
        if (i + batchSize < potentialSitemaps.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // 4. Collect all URLs
      sitemapResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allUrls.push(...result.value);
          logger.debug(`Sitemap ${potentialSitemaps[index]} provided ${result.value.length} URLs`);
        }
      });

      // 5. Filter and deduplicate
      const filteredUrls = URLValidationUtils.deduplicateUrls(allUrls)
        .filter(URLValidationUtils.isValidUrl)
        .slice(0, limit);

      const timeTaken = Date.now() - startTime;
      logger.info(`Sitemap discovery completed`, {
        url,
        totalFound: filteredUrls.length,
        timeTaken,
        sitemapsChecked: potentialSitemaps.length
      });

      return filteredUrls;

    } catch (error) {
      logger.error('Sitemap discovery failed', {
        url,
        error: (error as Error).message,
        timeTaken: Date.now() - startTime
      });
      return [];
    }
  }

  /**
   * Extract sitemap URLs from robots.txt
   */
  async extractSitemapsFromRobots(url: string): Promise<string[]> {
    try {
      const baseUrl = new URL(url).origin;
      const robotsUrl = `${baseUrl}/robots.txt`;

      const response = await axios.get(robotsUrl, {
        timeout: this.timeout,
        headers: { 'User-Agent': this.userAgent },
        maxContentLength: 1024 * 1024 // 1MB max for robots.txt
      });

      const robotsContent = response.data;
      const sitemapUrls: string[] = [];

      // Parse sitemap entries from robots.txt
      const lines = robotsContent.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.toLowerCase().startsWith('sitemap:')) {
          const sitemapUrl = trimmedLine.substring(8).trim();
          if (URLValidationUtils.isValidUrl(sitemapUrl)) {
            sitemapUrls.push(sitemapUrl);
          }
        }
      }

      logger.debug(`Found ${sitemapUrls.length} sitemaps in robots.txt`, { url: robotsUrl });
      return sitemapUrls;

    } catch (error) {
      logger.debug('Failed to fetch robots.txt for sitemap discovery', {
        url,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Parse a single sitemap (XML, text, or gzipped)
   */
  async parseSitemap(sitemapUrl: string): Promise<string[]> {
    try {
      const response = await axios.get(sitemapUrl, {
        timeout: this.timeout,
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Encoding': 'gzip, deflate'
        },
        maxContentLength: this.maxSitemapSize,
        responseType: 'arraybuffer'
      });

      let content: string;

      // Handle gzipped content
      if (sitemapUrl.endsWith('.gz') || response.headers['content-encoding'] === 'gzip') {
        try {
          const decompressed = pako.ungzip(new Uint8Array(response.data));
          content = new TextDecoder().decode(decompressed);
        } catch (gzipError) {
          // Fallback to treating as regular content
          content = Buffer.from(response.data).toString('utf-8');
        }
      } else {
        content = Buffer.from(response.data).toString('utf-8');
      }

      // Determine format and parse accordingly
      if (content.trim().startsWith('<?xml') || content.includes('<sitemapindex>') || content.includes('<urlset>')) {
        return await this.parseXmlSitemap(content, sitemapUrl);
      } else {
        return this.parseTextSitemap(content);
      }

    } catch (error) {
      logger.debug(`Failed to fetch sitemap: ${sitemapUrl}`, {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Parse XML sitemap content
   */
  private async parseXmlSitemap(content: string, sitemapUrl: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      parseString(content, { explicitArray: false }, async (err, result) => {
        if (err) {
          reject(new Error(`XML parsing failed: ${err.message}`));
          return;
        }

        try {
          const urls: string[] = [];

          // Handle sitemap index files
          if (result.sitemapindex && result.sitemapindex.sitemap) {
            const sitemaps = Array.isArray(result.sitemapindex.sitemap)
              ? result.sitemapindex.sitemap
              : [result.sitemapindex.sitemap];

            // Recursively parse child sitemaps
            const childPromises = sitemaps.map(async (sitemap: any) => {
              if (sitemap.loc) {
                try {
                  return await this.parseSitemap(sitemap.loc);
                } catch (error) {
                  logger.debug(`Failed to parse child sitemap: ${sitemap.loc}`);
                  return [];
                }
              }
              return [];
            });

            const childResults = await Promise.allSettled(childPromises);
            childResults.forEach(result => {
              if (result.status === 'fulfilled') {
                urls.push(...result.value);
              }
            });
          }

          // Handle regular sitemap files
          if (result.urlset && result.urlset.url) {
            const urlEntries = Array.isArray(result.urlset.url)
              ? result.urlset.url
              : [result.urlset.url];

            urlEntries.forEach((urlEntry: any) => {
              if (urlEntry.loc && typeof urlEntry.loc === 'string') {
                const url = urlEntry.loc.trim();
                if (URLValidationUtils.isValidUrl(url)) {
                  urls.push(url);
                }
              }
            });
          }

          logger.debug(`Parsed XML sitemap: ${sitemapUrl}`, { urlsFound: urls.length });
          resolve(urls);

        } catch (error) {
          reject(new Error(`Failed to process sitemap structure: ${(error as Error).message}`));
        }
      });
    });
  }

  /**
   * Parse text-based sitemap content
   */
  private parseTextSitemap(content: string): string[] {
    const urls: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const url = line.trim();
      if (url && URLValidationUtils.isValidUrl(url)) {
        urls.push(url);
      }
    }

    logger.debug('Parsed text sitemap', { urlsFound: urls.length });
    return urls;
  }

  /**
   * Get sitemap information with metadata
   */
  async getSitemapInfo(sitemapUrl: string): Promise<SitemapInfo[]> {
    try {
      const content = await this.fetchSitemapContent(sitemapUrl);

      if (content.trim().startsWith('<?xml')) {
        return await this.parseXmlSitemapWithMetadata(content);
      } else {
        const urls = this.parseTextSitemap(content);
        return urls.map(url => ({ url }));
      }
    } catch (error) {
      logger.error(`Failed to get sitemap info: ${sitemapUrl}`, {
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Parse XML sitemap with metadata
   */
  private async parseXmlSitemapWithMetadata(content: string): Promise<SitemapInfo[]> {
    return new Promise((resolve, reject) => {
      parseString(content, { explicitArray: false }, (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        const sitemapInfos: SitemapInfo[] = [];

        if (result.urlset && result.urlset.url) {
          const urlEntries = Array.isArray(result.urlset.url)
            ? result.urlset.url
            : [result.urlset.url];

          urlEntries.forEach((urlEntry: any) => {
            if (urlEntry.loc) {
              sitemapInfos.push({
                url: urlEntry.loc,
                lastModified: urlEntry.lastmod,
                changeFreq: urlEntry.changefreq,
                priority: urlEntry.priority ? parseFloat(urlEntry.priority) : undefined
              });
            }
          });
        }

        resolve(sitemapInfos);
      });
    });
  }


  /**
   * Fetch sitemap content as string
   */
  private async fetchSitemapContent(sitemapUrl: string): Promise<string> {
    const response = await axios.get(sitemapUrl, {
      timeout: this.timeout,
      headers: { 'User-Agent': this.userAgent },
      maxContentLength: this.maxSitemapSize,
      responseType: 'arraybuffer'
    });

    if (sitemapUrl.endsWith('.gz') || response.headers['content-encoding'] === 'gzip') {
      const decompressed = pako.ungzip(new Uint8Array(response.data));
      return new TextDecoder().decode(decompressed);
    } else {
      return Buffer.from(response.data).toString('utf-8');
    }
  }
}
