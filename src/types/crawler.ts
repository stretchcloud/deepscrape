import { ScraperOptions } from './index';

// Define crawl strategy types
export enum CrawlStrategy {
  BFS = 'bfs',  // Breadth-First Search (default)
  DFS = 'dfs',  // Depth-First Search
  BEST_FIRST = 'best_first' // Best-First Search
}

// Define hooks for crawler customization
export interface CrawlerHooks {
  beforeCrawl?: (url: string, options: CrawlerOptions) => Promise<void>;
  afterPageLoad?: (html: string, url: string) => Promise<string>;
  beforeContentExtraction?: (html: string, url: string) => Promise<string>;
  afterContentExtraction?: (content: ScrapedDocument, url: string) => Promise<ScrapedDocument>;
  beforeUrlDiscovery?: (html: string, url: string) => Promise<string>;
  afterUrlDiscovery?: (discoveredUrls: string[], url: string) => Promise<string[]>;
  onError?: (error: Error, url: string) => Promise<void>;
  beforeProcessingComplete?: (result: ScrapedDocument, url: string) => Promise<ScrapedDocument>;
}

export interface CrawlerOptions {
  jobId: string;
  initialUrl: string;
  baseUrl?: string;
  includes?: string[];
  excludes?: string[];
  limit?: number;
  maxCrawledLinks?: number;
  maxCrawledDepth?: number;
  allowBackwardCrawling?: boolean;
  allowExternalContentLinks?: boolean;
  allowSubdomains?: boolean;
  ignoreRobotsTxt?: boolean;
  regexOnFullURL?: boolean;
  strategy?: CrawlStrategy; // Added crawl strategy option
  hooks?: CrawlerHooks; // Added hooks
  maxDiscoveryDepth?: number;
  currentDiscoveryDepth?: number;
  useBrowser?: boolean; // Option to use browser-based crawling with Playwright
  deduplicateSimilarUrls?: boolean; // Enable similar URL deduplication (default: true)
}

export interface StoredCrawl {
  originUrl: string;
  crawlerOptions: {
    includePaths?: string[];
    excludePaths?: string[];
    limit?: number;
    maxDepth?: number;
    allowBackwardCrawling?: boolean;
    allowExternalContentLinks?: boolean;
    allowSubdomains?: boolean;
    ignoreRobotsTxt?: boolean;
    regexOnFullURL?: boolean;
    strategy?: CrawlStrategy; // Added crawl strategy
    useBrowser?: boolean; // Option to use browser-based crawling with Playwright
  };
  scrapeOptions: ScraperOptions;
  createdAt: number;
  robots?: string;
  cancelled?: boolean;
}

export interface CrawlRequest {
  url: string;
  includePaths?: string[];
  excludePaths?: string[];
  limit?: number;
  maxDepth?: number;
  allowBackwardCrawling?: boolean;
  allowExternalContentLinks?: boolean;
  allowSubdomains?: boolean;
  ignoreRobotsTxt?: boolean;
  regexOnFullURL?: boolean;
  scrapeOptions?: ScraperOptions;
  webhook?: string;
  strategy?: CrawlStrategy; // Added crawl strategy
  useBrowser?: boolean; // Option to use browser-based crawling with Playwright
}

export interface CrawlResponse {
  success: boolean;
  id?: string;
  url?: string;
  message?: string;
  outputDirectory?: string;
  error?: string;
}

export interface CrawlStatusParams {
  jobId: string;
}

export interface CrawlStatusQuery {
  skip?: string;
  limit?: string;
}

export interface ScrapedDocument {
  url: string;
  title?: string;
  content?: string;
  contentType?: 'html' | 'markdown' | 'text';
  html?: string;
  links?: string[];
  discoveredCount?: number;
  metadata?: {
    timestamp?: string;
    status?: number;
    headers?: Record<string, string>;
    processingTime?: number;
    loadTime?: number;
    fromCache?: boolean;
    [key: string]: any;
  };
}

export interface CrawlStatusResponse {
  success: boolean;
  status?: 'scraping' | 'completed' | 'cancelled';
  crawl?: StoredCrawl;
  jobs?: {
    id: string;
    status: string;
    document?: ScrapedDocument;
    error?: string;
  }[];
  count?: number;
  exportedFiles?: {
    count: number;
    outputDirectory: string;
    files: string[];
  };
  error?: string;
}

export interface CrawlCancelResponse {
  success: boolean;
  error?: string;
} 