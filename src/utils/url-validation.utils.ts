import { logger } from './logger';

/**
 * URL validation and normalization utilities
 */
export class URLValidationUtils {

  /**
   * Check if a URL is valid and accessible
   */
  static isValidUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);

      // Only allow HTTP and HTTPS protocols
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return false;
      }

      // Reject suspicious or dangerous URLs
      const dangerousPatterns = [
        'javascript:',
        'data:',
        'vbscript:',
        'file:',
        'about:',
        'blob:',
        'mailto:',
        'tel:',
        'ftp:'
      ];

      const lowerUrl = url.toLowerCase();
      if (dangerousPatterns.some(pattern => lowerUrl.includes(pattern))) {
        return false;
      }

      // Check for reasonable hostname
      if (!urlObj.hostname || urlObj.hostname.length < 3) {
        return false;
      }

      // Reject local/private IPs in production
      if (process.env.NODE_ENV === 'production') {
        const hostname = urlObj.hostname;
        if (
          hostname === 'localhost' ||
          hostname.startsWith('127.') ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.startsWith('172.')
        ) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Normalize URL for consistent comparison
   */
  static normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);

      // Remove fragment
      urlObj.hash = '';

      // Remove common tracking parameters
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'ref', 'source', 'campaign'
      ];

      trackingParams.forEach(param => {
        urlObj.searchParams.delete(param);
      });

      // Remove trailing slash for consistency
      if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }

      return urlObj.toString();
    } catch (error) {
      return url;
    }
  }

  /**
   * Check if URL matches domain constraints
   */
  static matchesDomain(url: string, baseUrl: string, includeSubdomains: boolean = true): boolean {
    try {
      const urlObj = new URL(url);
      const baseObj = new URL(baseUrl);

      if (includeSubdomains) {
        // Allow subdomains
        return urlObj.hostname === baseObj.hostname ||
               urlObj.hostname.endsWith('.' + baseObj.hostname);
      } else {
        // Exact hostname match only
        return urlObj.hostname === baseObj.hostname;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if URL matches path filters
   */
  static matchesPathFilters(url: string, pathFilters?: string[]): boolean {
    if (!pathFilters || pathFilters.length === 0) {
      return true;
    }

    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;

      return pathFilters.some(filter => {
        try {
          // First try as regex pattern (if it starts with ^ or contains regex special chars)
          if (filter.includes('^') || filter.includes('$') || filter.includes('.*') || filter.includes('\\')) {
            const regex = new RegExp(filter, 'i'); // case insensitive
            return regex.test(path);
          }
          
          // Fallback to simple string matching (case insensitive)
          const filterLower = filter.toLowerCase();
          const pathLower = path.toLowerCase();
          
          // Support contains, startsWith, and exact matches
          return pathLower.includes(filterLower) || 
                 pathLower.startsWith('/' + filterLower) ||
                 pathLower === filterLower;
        } catch (regexError) {
          // If regex fails, fallback to simple string matching
          const filterLower = filter.toLowerCase();
          const pathLower = path.toLowerCase();
          return pathLower.includes(filterLower) || pathLower.startsWith('/' + filterLower);
        }
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if URL matches exclude patterns
   */
  static matchesExcludeFilters(url: string, excludePatterns?: string[]): boolean {
    if (!excludePatterns || excludePatterns.length === 0) {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.toLowerCase();
      const fullUrl = url.toLowerCase();

      return excludePatterns.some(pattern => {
        const patternLower = pattern.toLowerCase();
        // Check both path and full URL
        return path.includes(patternLower) || fullUrl.includes(patternLower);
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate relevance score for search-based discovery
   */
  static calculateRelevanceScore(url: string, searchQuery?: string): number {
    if (!searchQuery) {
      return 1.0;
    }

    try {
      const urlObj = new URL(url);
      const searchTerms = searchQuery.toLowerCase().split(/\s+/);
      const urlText = (urlObj.pathname + urlObj.search).toLowerCase();

      let score = 0;
      searchTerms.forEach(term => {
        if (urlText.includes(term)) {
          score += 1;
        }
        // Bonus for exact matches in path segments
        const pathSegments = urlObj.pathname.split('/');
        if (pathSegments.some(segment => segment.toLowerCase() === term)) {
          score += 0.5;
        }
      });

      // Normalize score
      return Math.min(score / searchTerms.length, 1.0);
    } catch (error) {
      return 0.5; // Default score
    }
  }

  /**
   * Deduplicate URLs while preserving order
   */
  static deduplicateUrls(urls: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const url of urls) {
      const normalized = this.normalizeUrl(url);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(url);
      }
    }

    return result;
  }

  /**
   * Filter and sort URLs based on discovery options
   */
  static filterAndSortUrls(
    urls: string[],
    baseUrl: string,
    options: {
      includeSubdomains?: boolean;
      includePatterns?: string[];
      excludePatterns?: string[];
      searchQuery?: string;
      maxUrls?: number;
    }
  ): string[] {

    const filtered = urls
      .filter(url => this.isValidUrl(url))
      .filter(url => this.matchesDomain(url, baseUrl, options.includeSubdomains ?? true))
      .filter(url => this.matchesPathFilters(url, options.includePatterns))
      .filter(url => !this.matchesExcludeFilters(url, options.excludePatterns));

    // Deduplicate
    const deduplicated = this.deduplicateUrls(filtered);

    // Calculate relevance scores and sort
    const scored = deduplicated.map(url => ({
      url,
      score: this.calculateRelevanceScore(url, options.searchQuery)
    }));

    scored.sort((a, b) => b.score - a.score);

    // Apply maxUrls limit
    const maxUrls = options.maxUrls ?? 5000;
    return scored.slice(0, maxUrls).map(item => item.url);
  }

  /**
   * Extract base domain from URL
   */
  static getBaseDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      logger.warn('Failed to extract base domain from URL', { url, error: (error as Error).message });
      return '';
    }
  }

  /**
   * Check if URL exists and is accessible
   */
  static async checkUrlExists(url: string, timeout: number = 5000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
