import { logger } from '../utils/logger';

/**
 * Service for URL normalization and similar URL detection
 * Inspired by Firecrawl's approach to prevent duplicate content scraping
 */
export class UrlNormalizationService {
  // Common tracking parameters to remove
  private static readonly TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'msclkid', '_ga', 'mc_cid', 'mc_eid', 'ref',
    'source', 'campaign', 'medium', 'term', 'content', 'affiliate_id'
  ];

  /**
   * Normalize URL by removing unnecessary parameters and fragments
   */
  static normalizeUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      
      // Remove common tracking parameters
      this.TRACKING_PARAMS.forEach(param => {
        parsedUrl.searchParams.delete(param);
      });
      
      // Remove fragment (hash)
      parsedUrl.hash = '';
      
      // Normalize trailing slash for paths (but not for root)
      if (parsedUrl.pathname.endsWith('/') && parsedUrl.pathname.length > 1) {
        parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
      }
      
      // Sort search parameters for consistency
      parsedUrl.searchParams.sort();
      
      // Convert to lowercase hostname
      parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
      
      return parsedUrl.href;
    } catch (error) {
      logger.warn(`Failed to normalize URL: ${url}`, { error: (error as Error).message });
      return url; // Return original URL if parsing fails
    }
  }

  /**
   * Generate similar URL variations that might return the same content
   * This helps prevent duplicate scraping of essentially identical pages
   */
  static generateSimilarUrls(url: string): string[] {
    const normalized = this.normalizeUrl(url);
    const variations: string[] = [normalized];
    
    try {
      const parsedUrl = new URL(normalized);
      
      this.addSlashVariations(normalized, variations);
      this.addWwwVariations(parsedUrl, normalized, variations);
      this.addProtocolVariations(parsedUrl, normalized, variations);
      this.addIndexHtmlVariations(parsedUrl, normalized, variations);
      
      return [...new Set(variations)];
    } catch (error) {
      logger.warn(`Failed to generate similar URLs for: ${url}`, { error: (error as Error).message });
      return [normalized];
    }
  }

  /**
   * Check if two URLs are considered similar (would return same content)
   */
  static areUrlsSimilar(url1: string, url2: string): boolean {
    const variations1 = this.generateSimilarUrls(url1);
    const normalized2 = this.normalizeUrl(url2);
    
    return variations1.includes(normalized2);
  }

  /**
   * Extract domain from URL for grouping purposes
   */
  static extractDomain(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
    } catch (error) {
      logger.warn(`Failed to extract domain from URL: ${url}`, { error: (error as Error).message });
      return '';
    }
  }

  /**
   * Check if URL is likely to be a file (based on extension)
   */
  static isFileUrl(url: string): boolean {
    const fileExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip', '.rar', '.tar', '.gz', '.7z',
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
      '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
      '.exe', '.dmg', '.pkg', '.deb', '.rpm',
      '.iso', '.img'
    ];
    
    try {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname.toLowerCase();
      return fileExtensions.some(ext => path.endsWith(ext));
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate if URL is well-formed and accessible
   */
  static isValidUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      
      // Check protocol
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
      }
      
      // Check if hostname exists
      if (!parsedUrl.hostname || parsedUrl.hostname.length === 0) {
        return false;
      }
      
      // Check for localhost or internal IPs in production
      if (process.env.NODE_ENV === 'production') {
        const hostname = parsedUrl.hostname.toLowerCase();
        if (hostname === 'localhost' || 
            hostname.startsWith('127.') || 
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.16.') ||
            hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get URL depth (number of path segments)
   */
  static getUrlDepth(url: string): number {
    try {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname.endsWith('/') 
        ? parsedUrl.pathname.slice(0, -1) 
        : parsedUrl.pathname;
        
      if (path === '' || path === '/') return 0;
      return path.split('/').filter(Boolean).length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Add trailing slash variations
   */
  private static addSlashVariations(normalized: string, variations: string[]): void {
    const withSlash = new URL(normalized);
    if (!withSlash.pathname.endsWith('/')) {
      withSlash.pathname += '/';
      variations.push(withSlash.href);
    }
    
    const withoutSlash = new URL(normalized);
    if (withoutSlash.pathname.endsWith('/') && withoutSlash.pathname.length > 1) {
      withoutSlash.pathname = withoutSlash.pathname.slice(0, -1);
      variations.push(withoutSlash.href);
    }
  }

  /**
   * Add www subdomain variations
   */
  private static addWwwVariations(parsedUrl: URL, normalized: string, variations: string[]): void {
    if (parsedUrl.hostname.startsWith('www.')) {
      this.addWithoutWwwVariations(normalized, variations);
    } else {
      this.addWithWwwVariations(normalized, variations);
    }
  }

  /**
   * Add variations without www subdomain
   */
  private static addWithoutWwwVariations(normalized: string, variations: string[]): void {
    const withoutWww = new URL(normalized);
    withoutWww.hostname = withoutWww.hostname.replace('www.', '');
    variations.push(withoutWww.href);
    
    const withoutWwwWithSlash = new URL(withoutWww.href);
    if (!withoutWwwWithSlash.pathname.endsWith('/')) {
      withoutWwwWithSlash.pathname += '/';
      variations.push(withoutWwwWithSlash.href);
    }
  }

  /**
   * Add variations with www subdomain
   */
  private static addWithWwwVariations(normalized: string, variations: string[]): void {
    const withWww = new URL(normalized);
    withWww.hostname = 'www.' + withWww.hostname;
    variations.push(withWww.href);
    
    const withWwwWithSlash = new URL(withWww.href);
    if (!withWwwWithSlash.pathname.endsWith('/')) {
      withWwwWithSlash.pathname += '/';
      variations.push(withWwwWithSlash.href);
    }
  }

  /**
   * Add HTTP/HTTPS protocol variations
   */
  private static addProtocolVariations(parsedUrl: URL, normalized: string, variations: string[]): void {
    if (parsedUrl.protocol === 'https:') {
      const httpVersion = new URL(normalized);
      httpVersion.protocol = 'http:';
      variations.push(httpVersion.href);
    } else if (parsedUrl.protocol === 'http:') {
      const httpsVersion = new URL(normalized);
      httpsVersion.protocol = 'https:';
      variations.push(httpsVersion.href);
    }
  }

  /**
   * Add index.html file variations
   */
  private static addIndexHtmlVariations(parsedUrl: URL, normalized: string, variations: string[]): void {
    if (!parsedUrl.pathname.includes('.')) {
      const withIndex = new URL(normalized);
      withIndex.pathname = withIndex.pathname.endsWith('/') 
        ? withIndex.pathname + 'index.html'
        : withIndex.pathname + '/index.html';
      variations.push(withIndex.href);
    }
    
    if (parsedUrl.pathname.endsWith('/index.html')) {
      const withoutIndex = new URL(normalized);
      withoutIndex.pathname = withoutIndex.pathname.replace('/index.html', '/');
      variations.push(withoutIndex.href);
    }
  }
}