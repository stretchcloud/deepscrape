// Streaming crawl architecture types

export interface StreamingDiscoveryOptions {
  url: string;
  maxUrls?: number;
  includeSubdomains?: boolean;
  searchQuery?: string;
  skipSitemaps?: boolean;
  sitemapsOnly?: boolean;
  timeoutMs?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  batchSize?: number; // How many URLs to process in each batch
}

export interface UrlBatch {
  urls: string[];
  method: 'sitemap' | 'browser' | 'commonPaths' | 'robots' | 'search' | 'documents';
  batchNumber: number;
  totalProcessed: number;
}

export type UrlStreamHandler = (batch: UrlBatch) => Promise<void>;

export interface StreamingDiscoveryResult {
  totalUrls: number;
  discoveryMethods: {
    sitemap: number;
    browser: number;
    commonPaths: number;
    robots: number;
    search: number;
    documents: number;
  };
  timeTaken: number;
  batchesProcessed: number;
  streamingComplete: boolean;
}

export interface StreamingMethodResult {
  method: 'sitemap' | 'browser' | 'commonPaths' | 'robots' | 'search' | 'documents';
  urlsFound: number;
  batchesStreamed: number;
  timeTaken: number;
  completed: boolean;
  error?: string;
}

export interface CrawlKickoffOptions {
  crawlId: string;
  url: string;
  limit?: number;
  maxDepth?: number;
  allowSubdomains?: boolean;
  includePaths?: string[];
  excludePaths?: string[];
  scrapeOptions?: any;
  useMapDiscovery?: boolean;
  concurrency?: number;
}

export interface CrawlKickoffResult {
  success: boolean;
  crawlId: string;
  initialJobId: string;
  discoveryStarted: boolean;
  estimatedUrls?: number;
  message: string;
}
