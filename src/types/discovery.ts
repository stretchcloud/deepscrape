// URL Discovery types for the /api/map endpoint

export interface RateLimitingOptions {
  minDelay?: number;                 // Minimum delay between requests (ms) - default: 500
  maxConcurrency?: number;           // Maximum concurrent requests - default: 2
  sitemapDelay?: number;            // Delay between sitemap requests (ms) - default: 300
  batchSize?: number;               // Batch size for common path testing - default: 3
  browserTimeout?: number;          // Browser discovery timeout (ms) - default: 10000
  enableRetry?: boolean;            // Enable exponential backoff retry - default: true
  maxRetries?: number;              // Maximum retry attempts - default: 3
}

export interface CrawlOptions {
  maxCrawlDepth?: number;           // Default: 3, Max: 5
  maxConcurrentCrawlers?: number;   // Default: 8, Max: 20
  crawlTimeoutPerPage?: number;     // Default: 3000ms, Max: 10000ms
  maxLinksPerPage?: number;         // Default: 100, Max: 500
  enableDeepCrawling?: boolean;     // Default: true
  browserPoolSize?: number;         // Default: 5, Max: 15
}

export interface DiscoveryOptions {
  url: string;
  maxUrls?: number;                  // Default: 5000, Max: 30000 (renamed from 'limit')
  includeSubdomains?: boolean;       // Default: true
  searchQuery?: string;              // Optional search query (renamed from 'search')
  skipSitemaps?: boolean;            // Default: false (renamed from 'ignoreSitemap')
  sitemapsOnly?: boolean;            // Default: false (renamed from 'sitemapOnly')
  useUrlIndex?: boolean;             // Default: true (renamed from 'useIndex')
  timeoutMs?: number;                // Default: 30000ms (renamed from 'timeout')
  includePatterns?: string[];        // Path patterns to include (renamed from 'filterByPath')
  excludePatterns?: string[];        // Path patterns to exclude (renamed from 'excludePaths')
  rateLimitingOptions?: RateLimitingOptions; // Rate limiting configuration
  crawlOptions?: CrawlOptions;       // NEW: Crawl-based discovery configuration
}

export interface DiscoveryResult {
  links: string[];
  total: number;
  discoveryMethods: {
    sitemap: number;
    search: number;
    crawling: number;
    commonPaths: number;
    robotsSitemaps: number;
    documents: number;
  };
  timeTaken: number;
  fromCache: boolean;
  searchQuery?: string;
  /** True when the soft deadline was hit and the URL list may be incomplete. */
  partial?: boolean;
}

export interface DiscoveryMethodResult {
  urls: string[];
  method: 'sitemap' | 'search' | 'crawling' | 'commonPaths' | 'robotsSitemaps' | 'documents';
  timeTaken: number;
  error?: string;
}

export interface SitemapInfo {
  url: string;
  lastModified?: string;
  changeFreq?: string;
  priority?: number;
}

export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
  relevanceScore?: number;
}

export interface FilterOptions {
  includeSubdomains: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  searchQuery?: string;
}

export interface MapRequest {
  url: string;
  maxUrls?: number;
  includeSubdomains?: boolean;
  searchQuery?: string;
  skipSitemaps?: boolean;
  sitemapsOnly?: boolean;
  useUrlIndex?: boolean;
  timeoutMs?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  rateLimitingOptions?: RateLimitingOptions;
  crawlOptions?: CrawlOptions;       // NEW: Runtime crawl configuration
}

export interface MapResponse {
  success: boolean;
  data: DiscoveryResult;
  metadata: {
    url: string;
    includeSubdomains: boolean;
    maxUrls: number;
    timestamp: string;
    /** True when discovery hit the soft deadline; widen timeoutMs for more. */
    partial?: boolean;
  };
  error?: string;
}
