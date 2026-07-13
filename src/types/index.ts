// Scraping options
export interface ScraperOptions {
  timeout?: number;
  blockAds?: boolean;
  blockResources?: boolean;
  userAgent?: string;
  proxy?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  waitForSelector?: string;
  waitForTimeout?: number; // Time to wait after page loads (in ms)
  fullPage?: boolean;
  javascript?: boolean;
  extractorFormat?: 'html' | 'markdown' | 'text';
  onlyMainContent?: boolean; // Extract only the main content, stripping nav/footer/ads (default true)
  fitMarkdown?: boolean; // Use the pruning content filter for high-fidelity "fit markdown" (default true)
  includeRawHtml?: boolean; // Attach the raw pre-clean HTML to the response (used for crawl link discovery)
  formats?: string[]; // Multi-format output in one request: any of markdown|html|rawHtml|text|links|screenshot|pdf|mhtml|tables
  capturePdf?: boolean; // Render the page to PDF (browser path)
  captureMhtml?: boolean; // Capture an MHTML snapshot (browser path)
  executeJs?: string; // Arbitrary JS to evaluate in the page; result returned in jsResult (gated by ENABLE_JS_EXECUTION)
  actions?: BrowserAction[];
  url?: string; // For cookie domain when no URL is provided in launch options
  puppeteerLaunchOptions?: Record<string, any>;
  skipCache?: boolean; // Skip cache for this request
  cacheTtl?: number; // Custom TTL for caching this response (in seconds)
  skipTlsVerification?: boolean; // Skip TLS verification for HTTPS connections

  // Browser-based crawling options
  useBrowser?: boolean; // Use browser-based crawling with Playwright
  preferHttpScraper?: boolean; // Use the fast HTTP (axios) scraper first; only fall back to Playwright if it fails/returns empty (great for server-rendered sites)
  stealthMode?: boolean; // Enable stealth mode to avoid detection
  maxScrolls?: number; // Maximum number of scrolls for extracting dynamic content

  // Rate limiting options
  minDelay?: number; // Minimum delay between requests (ms)
  maxDelay?: number; // Maximum delay for exponential backoff (ms)
  maxRetries?: number; // Maximum number of retries for failed requests
  backoffFactor?: number; // Exponential backoff factor
  rotateUserAgent?: boolean; // Rotate user agents between requests

  // Proxy options
  proxyUsername?: string; // Username for proxy authentication
  proxyPassword?: string; // Password for proxy authentication
  proxyRotation?: boolean; // Enable proxy rotation
  proxyList?: string[]; // List of proxy URLs to rotate through

  // Discovery options for browser crawling
  discoverLinks?: boolean; // Discover links on the page
  maxDiscoveryDepth?: number; // Maximum depth for discovery
  discoveryLimit?: number; // Maximum number of URLs to discover
  includePaths?: string[]; // Regex patterns for paths to include
  excludePaths?: string[]; // Regex patterns for paths to exclude
  excludeDomains?: string[]; // Domains to exclude
  baseUrl?: string; // Base URL for relative links
}

// Browser action interface
export interface BrowserAction {
  type: 'click' | 'scroll' | 'wait' | 'fill' | 'select';
  selector?: string;
  value?: string;
  position?: number;  // For scroll actions (pixels)
  timeout?: number;   // For wait actions (ms)
  optional?: boolean; // If true, action failure won't stop scraping
}

// Response from the scraper
export interface ScraperResponse {
  url: string;
  title: string;
  content: string;
  contentType: 'html' | 'markdown' | 'text';
  metadata: {
    timestamp: string;
    status: number;
    headers: Record<string, string>;
    processingTime?: number; // Total processing time in milliseconds
    loadTime?: number;       // Time to load the page in milliseconds
    cacheTtl?: number;       // Cache TTL for this response
    cachedAt?: string;       // When this response was cached
    fromCache?: boolean;     // Whether this response came from cache
    [key: string]: any;
  };
  screenshot?: Buffer;
  error?: string;
  extractedData?: any;
  structuredData?: any;               // Structured data from CSS or LLM extraction
  extractionResult?: any;             // Full extraction result (success/data/error/metadata)
  rawHtml?: string;                   // Raw pre-clean HTML (when includeRawHtml is set)
  formats?: Record<string, any>;      // Multi-format output {markdown, html, rawHtml, text, links, screenshot, pdf, mhtml, tables}
  pdf?: Buffer;                       // Rendered PDF (when capturePdf)
  mhtml?: string;                     // MHTML snapshot (when captureMhtml)
  jsResult?: any;                     // Result of executeJs
}

// API request
export interface ScrapeRequest {
  url: string;
  options?: ScraperOptions;
}

// API response
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    processingTime?: number;
    fromCache?: boolean;
    model?: string;
  };
}

// Batch scraping interfaces
export interface BatchScrapeRequest {
  urls: string[];
  options?: ScraperOptions;
  concurrency?: number;
  webhook?: string;
  timeout?: number;
  failFast?: boolean;
  maxRetries?: number;
}

export interface BatchScrapeJob {
  id: string;
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: ScraperResponse;
  error?: string;
  startTime?: number;
  endTime?: number;
  processingTime?: number;
  retryCount?: number;
}

export interface BatchScrapeResponse {
  success: boolean;
  batchId: string;
  totalUrls: number;
  message: string;
  statusUrl: string;
  webhook?: string;
  estimatedTime?: number;
}

export interface BatchScrapeStatusResponse {
  success: boolean;
  batchId: string;
  status: 'pending' | 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  totalUrls: number;
  completedUrls: number;
  failedUrls: number;
  pendingUrls: number;
  jobs: BatchScrapeJob[];
  results?: ScraperResponse[];
  startTime: number;
  endTime?: number;
  processingTime?: number;
  progress: number; // Percentage completion
  error?: string;
}

// Ad blocking domains adapted from FireCrawl
export const AD_SERVING_DOMAINS = [
  'googlesyndication.com',
  'adservice.google.com',
  'doubleclick.net',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'amazon-adsystem.com',
  'facebook.com/tr',
  'facebook.net',
  'advertising.com',
  'adtechus.com',
  'quantserve.com',
  'scorecard.com',
  'zedo.com',
  'adblade.com',
  'adform.net',
  'adnxs.com',
  'criteo.com',
  'outbrain.com',
  'taboola.com'
];
