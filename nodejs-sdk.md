# 🚀 DeepScraper Node.js SDK - Design & Architecture

## Overview

The DeepScraper Node.js SDK provides a powerful, type-safe, and intuitive interface for interacting with the DeepScraper API. Built with TypeScript, it offers comprehensive web scraping, crawling, and AI-powered data extraction capabilities.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Installation & Setup](#installation--setup)
3. [Core Components](#core-components)
4. [API Design](#api-design)
5. [Authentication](#authentication)
6. [Resource Classes](#resource-classes)
7. [Error Handling](#error-handling)
8. [TypeScript Support](#typescript-support)
9. [Usage Examples](#usage-examples)
10. [Advanced Features](#advanced-features)
11. [Testing Strategy](#testing-strategy)
12. [Publishing & Distribution](#publishing--distribution)

## Architecture Overview

### Design Principles

1. **Developer Experience First**: Intuitive API with excellent TypeScript support
2. **Flexibility**: Support both simple and complex use cases
3. **Performance**: Efficient handling of large-scale operations
4. **Reliability**: Built-in retry logic and error recovery
5. **Extensibility**: Plugin architecture for custom behaviors

### SDK Structure

```
@deepscraper/node-sdk/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── client.ts                # Core DeepScraperClient class
│   ├── config.ts                # Configuration management
│   ├── auth/
│   │   ├── index.ts            # Authentication handler
│   │   └── interceptor.ts      # Request interceptor for auth
│   ├── resources/
│   │   ├── base.ts             # Base resource class
│   │   ├── scraper.ts          # Scraping operations
│   │   ├── crawler.ts          # Crawling operations
│   │   ├── batch.ts            # Batch processing
│   │   ├── map.ts              # URL discovery
│   │   └── extraction.ts       # LLM extraction
│   ├── types/
│   │   ├── index.ts            # Re-export all types
│   │   ├── scraper.types.ts    # Scraping-related types
│   │   ├── crawler.types.ts    # Crawler types
│   │   ├── batch.types.ts      # Batch types
│   │   ├── map.types.ts        # Map/discovery types
│   │   └── common.types.ts     # Shared types
│   ├── errors/
│   │   ├── base.ts             # Base error class
│   │   ├── api.ts              # API-specific errors
│   │   ├── validation.ts       # Validation errors
│   │   └── index.ts            # Error exports
│   ├── utils/
│   │   ├── retry.ts            # Retry logic
│   │   ├── validators.ts       # Input validators
│   │   ├── helpers.ts          # Helper functions
│   │   └── logger.ts           # Logging utilities
│   └── http/
│       ├── client.ts           # HTTP client wrapper
│       ├── interceptors.ts     # Request/response interceptors
│       └── stream.ts           # Streaming support
├── tests/
│   ├── unit/                   # Unit tests
│   ├── integration/            # Integration tests
│   └── fixtures/               # Test fixtures
├── examples/
│   ├── basic-scraping.ts       # Simple scraping example
│   ├── advanced-crawling.ts    # Complex crawling
│   ├── batch-processing.ts     # Batch operations
│   ├── llm-extraction.ts       # AI extraction
│   └── streaming.ts            # Streaming example
├── docs/
│   ├── API.md                  # API documentation
│   ├── EXAMPLES.md             # Extended examples
│   └── MIGRATION.md            # Migration guides
├── package.json
├── tsconfig.json
├── .npmignore
└── README.md
```

## Installation & Setup

### NPM Package

```json
{
  "name": "@deepscraper/node-sdk",
  "version": "1.0.0",
  "description": "Official Node.js SDK for DeepScraper API",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "form-data": "^4.0.0",
    "eventemitter3": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  },
  "peerDependencies": {
    "node": ">=14.0.0"
  },
  "engines": {
    "node": ">=14.0.0"
  }
}
```

### Installation

```bash
npm install @deepscraper/node-sdk
# or
yarn add @deepscraper/node-sdk
# or
pnpm add @deepscraper/node-sdk
```

## Core Components

### 1. DeepScraperClient

The main client class that provides access to all API resources.

```typescript
// src/client.ts
import { ScraperResource } from './resources/scraper';
import { CrawlerResource } from './resources/crawler';
import { BatchResource } from './resources/batch';
import { MapResource } from './resources/map';
import { HttpClient } from './http/client';
import { DeepScraperConfig } from './types';

export class DeepScraperClient {
  private httpClient: HttpClient;
  
  // Resources
  public scraper: ScraperResource;
  public crawler: CrawlerResource;
  public batch: BatchResource;
  public map: MapResource;
  
  constructor(config: DeepScraperConfig) {
    this.httpClient = new HttpClient(config);
    
    // Initialize resources
    this.scraper = new ScraperResource(this.httpClient);
    this.crawler = new CrawlerResource(this.httpClient);
    this.batch = new BatchResource(this.httpClient);
    this.map = new MapResource(this.httpClient);
  }
  
  // Convenience methods
  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    return this.scraper.scrape(url, options);
  }
  
  async crawl(url: string, options?: CrawlOptions): Promise<CrawlJob> {
    return this.crawler.start(url, options);
  }
  
  async discover(url: string, options?: MapOptions): Promise<DiscoveryResult> {
    return this.map.discover(url, options);
  }
}
```

### 2. Configuration

Flexible configuration with environment variable support.

```typescript
// src/config.ts
export interface DeepScraperConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
  debug?: boolean;
}

export const DEFAULT_CONFIG: Partial<DeepScraperConfig> = {
  baseUrl: 'https://app.extractr.ai',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
  debug: false
};

export function createConfig(options: DeepScraperConfig): DeepScraperConfig {
  return {
    ...DEFAULT_CONFIG,
    ...options,
    apiKey: options.apiKey || process.env.EXTRACTR_API_KEY || process.env.DEEPSCRAPER_API_KEY || ''
  };
}
```

### 3. HTTP Client

Axios-based HTTP client with interceptors and retry logic.

```typescript
// src/http/client.ts
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { DeepScraperConfig } from '../types';
import { setupInterceptors } from './interceptors';
import { RetryHandler } from '../utils/retry';

export class HttpClient {
  private axios: AxiosInstance;
  private retryHandler: RetryHandler;
  
  constructor(private config: DeepScraperConfig) {
    this.axios = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
        'User-Agent': '@deepscraper/node-sdk/1.0.0',
        ...config.headers
      }
    });
    
    this.retryHandler = new RetryHandler(config);
    setupInterceptors(this.axios, this.config);
  }
  
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    return this.retryHandler.execute(() => 
      this.axios.request<T>(config).then(res => res.data)
    );
  }
  
  // Convenience methods
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url });
  }
  
  post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }
  
  put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }
  
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }
}
```

## API Design

### Fluent Interface

The SDK provides a fluent interface for building complex requests:

```typescript
// Basic scraping
const result = await client.scraper
  .url('https://example.com')
  .format('markdown')
  .waitFor('.content')
  .execute();

// Advanced crawling with chaining
const crawl = await client.crawler
  .start('https://docs.example.com')
  .depth(3)
  .limit(100)
  .include(['/api/', '/guides/'])
  .exclude(['/old/', '/archive/'])
  .useMapDiscovery()
  .onProgress((progress) => console.log(`Progress: ${progress.percentage}%`))
  .execute();

// Batch processing with options
const batch = await client.batch
  .urls(['https://site1.com', 'https://site2.com'])
  .concurrency(5)
  .format('markdown')
  .onComplete((result) => console.log(`Completed: ${result.url}`))
  .execute();
```

### Promise-Based API

All methods return promises and support async/await:

```typescript
// Using async/await
async function scrapeWebsite() {
  try {
    const result = await client.scrape('https://example.com', {
      format: 'markdown',
      waitForSelector: '.main-content'
    });
    console.log(result.content);
  } catch (error) {
    console.error('Scraping failed:', error);
  }
}

// Using promises
client.scrape('https://example.com')
  .then(result => console.log(result.content))
  .catch(error => console.error(error));
```

## Authentication

### API Key Authentication

```typescript
// src/auth/index.ts
export class AuthHandler {
  constructor(private apiKey: string) {}
  
  getHeaders(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey
    };
  }
  
  validateApiKey(): void {
    if (!this.apiKey || this.apiKey.length < 10) {
      throw new Error('Invalid API key');
    }
  }
}
```

### Multiple Authentication Methods

```typescript
// Environment variable (supports both EXTRACTR_API_KEY and DEEPSCRAPER_API_KEY)
const client = new DeepScraperClient({
  apiKey: process.env.EXTRACTR_API_KEY || process.env.DEEPSCRAPER_API_KEY
});

// Direct configuration
const client = new DeepScraperClient({
  apiKey: 'your-api-key-here'
});

// OAuth2 support (future)
const client = new DeepScraperClient({
  auth: {
    type: 'oauth2',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret'
  }
});
```

## Resource Classes

### 1. Scraper Resource

Handles single-page scraping operations.

```typescript
// src/resources/scraper.ts
export class ScraperResource extends BaseResource {
  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    const response = await this.http.post<ApiResponse<ScrapeResult>>('/api/scrape', {
      url,
      options: this.validateOptions(options)
    });
    
    if (!response.success) {
      throw new ScraperError(response.error || 'Scraping failed');
    }
    
    return response.data!;
  }
  
  // Builder pattern methods
  private builder = new ScrapeBuilder();
  
  url(url: string): ScrapeBuilder {
    return this.builder.url(url);
  }
  
  format(format: 'html' | 'markdown' | 'text'): ScrapeBuilder {
    return this.builder.format(format);
  }
  
  // LLM extraction with schema
  async extract<T>(url: string, schema: Schema, options?: ExtractOptions): Promise<T> {
    const extractOptions: ScrapeOptions = {
      ...options,
      extractionOptions: {
        schema,
        extractionType: 'structured'
      }
    };
    
    const result = await this.scrape(url, extractOptions);
    return result.extractedData as T;
  }
}
```

### 2. Crawler Resource

Manages multi-page crawling operations.

```typescript
// src/resources/crawler.ts
export class CrawlerResource extends BaseResource {
  async start(url: string, options?: CrawlOptions): Promise<CrawlJob> {
    const response = await this.http.post<CrawlResponse>('/api/crawl', {
      url,
      ...options
    });
    
    if (!response.success) {
      throw new CrawlerError(response.error || 'Failed to start crawl');
    }
    
    return new CrawlJob(this.http, response.id!, response.url!);
  }
  
  async status(jobId: string): Promise<CrawlStatus> {
    const response = await this.http.get<CrawlStatusResponse>(`/api/crawl/${jobId}`);
    return response;
  }
  
  async cancel(jobId: string): Promise<void> {
    await this.http.post(`/api/crawl/${jobId}/cancel`);
  }
  
  // Stream crawl results
  async *stream(jobId: string): AsyncGenerator<CrawlResult> {
    let offset = 0;
    const limit = 50;
    
    while (true) {
      const status = await this.status(jobId);
      const jobs = status.jobs?.slice(offset, offset + limit) || [];
      
      for (const job of jobs) {
        if (job.document) {
          yield job.document;
        }
      }
      
      offset += jobs.length;
      
      if (status.status === 'completed' && jobs.length < limit) {
        break;
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// CrawlJob class for managing ongoing crawls
export class CrawlJob {
  constructor(
    private http: HttpClient,
    public id: string,
    public statusUrl: string
  ) {}
  
  async getStatus(): Promise<CrawlStatus> {
    return this.http.get<CrawlStatus>(this.statusUrl);
  }
  
  async waitForCompletion(options?: WaitOptions): Promise<CrawlStatus> {
    const maxWaitTime = options?.timeout || 300000; // 5 minutes default
    const pollInterval = options?.pollInterval || 2000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getStatus();
      
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
      
      if (options?.onProgress) {
        options.onProgress(status);
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error('Crawl timed out');
  }
  
  async cancel(): Promise<void> {
    await this.http.post(`/api/crawl/${this.id}/cancel`);
  }
}
```

### 3. Batch Resource

Handles batch scraping operations.

```typescript
// src/resources/batch.ts
export class BatchResource extends BaseResource {
  async create(urls: string[], options?: BatchOptions): Promise<BatchJob> {
    const response = await this.http.post<BatchScrapeResponse>('/api/batch/scrape', {
      urls,
      options: options?.scrapeOptions,
      concurrency: options?.concurrency,
      webhook: options?.webhook
    });
    
    if (!response.success) {
      throw new BatchError(response.error || 'Failed to create batch');
    }
    
    return new BatchJob(this.http, response.batchId, response.statusUrl);
  }
  
  async status(batchId: string): Promise<BatchStatus> {
    return this.http.get<BatchStatus>(`/api/batch/scrape/${batchId}/status`);
  }
  
  async downloadZip(batchId: string, format?: 'json' | 'markdown'): Promise<Buffer> {
    const response = await this.http.get(`/api/batch/scrape/${batchId}/download`, {
      params: { format },
      responseType: 'arraybuffer'
    });
    
    return Buffer.from(response);
  }
  
  // Process URLs in chunks
  async processInChunks(
    urls: string[], 
    chunkSize: number = 100,
    options?: BatchOptions
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    
    for (let i = 0; i < urls.length; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);
      const batch = await this.create(chunk, options);
      const finalStatus = await batch.waitForCompletion();
      
      results.push(...finalStatus.results || []);
    }
    
    return results;
  }
}
```

### 4. Map Resource

URL discovery and sitemap operations.

```typescript
// src/resources/map.ts
export class MapResource extends BaseResource {
  async discover(url: string, options?: MapOptions): Promise<DiscoveryResult> {
    const response = await this.http.post<MapResponse>('/api/map', {
      url,
      maxUrls: options?.maxUrls || 5000,
      includeSubdomains: options?.includeSubdomains ?? true,
      searchQuery: options?.searchQuery,
      includePatterns: options?.includePatterns,
      excludePatterns: options?.excludePatterns,
      ...options
    });
    
    if (!response.success) {
      throw new MapError(response.error || 'Discovery failed');
    }
    
    return response.data;
  }
  
  // Discover and crawl workflow
  async discoverAndCrawl(
    url: string, 
    mapOptions?: MapOptions,
    crawlOptions?: CrawlOptions
  ): Promise<CrawlJob> {
    // First discover URLs
    const discovery = await this.discover(url, mapOptions);
    
    // Then start crawl with discovered URLs
    const crawler = new CrawlerResource(this.http);
    return crawler.start(url, {
      ...crawlOptions,
      useMapDiscovery: true,
      maxUrls: discovery.total
    });
  }
  
  // Get crawlable URLs based on patterns
  async getCrawlableUrls(
    url: string,
    patterns: string[],
    options?: MapOptions
  ): Promise<string[]> {
    const discovery = await this.discover(url, {
      ...options,
      includePatterns: patterns
    });
    
    return discovery.links;
  }
}
```

## Error Handling

### Custom Error Classes

```typescript
// src/errors/base.ts
export abstract class DeepScraperError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// src/errors/api.ts
export class ApiError extends DeepScraperError {
  constructor(message: string, statusCode: number, details?: any) {
    super(message, 'API_ERROR', statusCode, details);
  }
}

export class AuthenticationError extends DeepScraperError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 401);
  }
}

export class RateLimitError extends DeepScraperError {
  constructor(
    message: string = 'Rate limit exceeded',
    public retryAfter?: number
  ) {
    super(message, 'RATE_LIMIT', 429);
  }
}

export class ValidationError extends DeepScraperError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', 400, { field });
  }
}
```

### Error Interceptor

```typescript
// src/http/interceptors.ts
export function setupInterceptors(axios: AxiosInstance, config: DeepScraperConfig) {
  // Response error interceptor
  axios.interceptors.response.use(
    response => response,
    async error => {
      if (error.response) {
        const { status, data } = error.response;
        
        switch (status) {
          case 401:
            throw new AuthenticationError(data.error || 'Invalid API key');
          
          case 429:
            const retryAfter = error.response.headers['retry-after'];
            throw new RateLimitError(data.error, retryAfter);
          
          case 400:
            throw new ValidationError(data.error || 'Invalid request');
          
          case 404:
            throw new NotFoundError(data.error || 'Resource not found');
          
          case 500:
          case 502:
          case 503:
            throw new ServerError(data.error || 'Server error', status);
          
          default:
            throw new ApiError(
              data.error || `Request failed with status ${status}`,
              status,
              data
            );
        }
      } else if (error.request) {
        throw new NetworkError('No response from server');
      } else {
        throw new DeepScraperError('Request setup failed', 'REQUEST_ERROR');
      }
    }
  );
}
```

### Retry Logic

```typescript
// src/utils/retry.ts
export class RetryHandler {
  constructor(private config: DeepScraperConfig) {}
  
  async execute<T>(
    fn: () => Promise<T>,
    options?: RetryOptions
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? this.config.maxRetries ?? 3;
    const retryDelay = options?.retryDelay ?? this.config.retryDelay ?? 1000;
    const backoffFactor = options?.backoffFactor ?? 2;
    
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry certain errors
        if (
          error instanceof AuthenticationError ||
          error instanceof ValidationError ||
          (error instanceof ApiError && error.statusCode === 404)
        ) {
          throw error;
        }
        
        // Check if we should retry
        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(backoffFactor, attempt);
          
          if (this.config.debug) {
            console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError!;
  }
}
```

## TypeScript Support

### Type Definitions

```typescript
// src/types/scraper.types.ts
export interface ScrapeOptions {
  format?: 'html' | 'markdown' | 'text';
  timeout?: number;
  waitForSelector?: string;
  waitForTimeout?: number;
  fullPage?: boolean;
  javascript?: boolean;
  blockAds?: boolean;
  blockResources?: boolean;
  userAgent?: string;
  proxy?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  actions?: BrowserAction[];
  extractionOptions?: ExtractionOptions;
}

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  contentType: 'html' | 'markdown' | 'text';
  metadata: {
    timestamp: string;
    status: number;
    headers: Record<string, string>;
    processingTime?: number;
    [key: string]: any;
  };
  screenshot?: Buffer;
  extractedData?: any;
}

export interface BrowserAction {
  type: 'click' | 'scroll' | 'wait' | 'fill' | 'select';
  selector?: string;
  value?: string;
  position?: number;
  timeout?: number;
  optional?: boolean;
}

// Schema types for LLM extraction
export interface Schema {
  type: 'object';
  title?: string;
  description?: string;
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

export interface SchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  enum?: any[];
  format?: string;
}
```

### Type Guards

```typescript
// src/utils/type-guards.ts
export function isScrapeResult(value: any): value is ScrapeResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.url === 'string' &&
    typeof value.content === 'string' &&
    ['html', 'markdown', 'text'].includes(value.contentType)
  );
}

export function isCrawlStatus(value: any): value is CrawlStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.success === 'boolean' &&
    ['scraping', 'completed', 'failed'].includes(value.status)
  );
}
```

## Usage Examples

### Configuration

```typescript
import { DeepScraperClient } from '@deepscraper/node-sdk';

// The SDK connects to https://app.extractr.ai by default
const client = new DeepScraperClient({
  apiKey: 'your-api-key'
});

// Or specify a custom endpoint
const client = new DeepScraperClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-custom-endpoint.com'
});
```

### Basic Scraping

```typescript
import { DeepScraperClient } from '@deepscraper/node-sdk';

const client = new DeepScraperClient({
  apiKey: 'your-api-key'
});

// Simple scraping
async function basicScrape() {
  const result = await client.scrape('https://example.com');
  console.log(result.content);
}

// Scraping with options
async function advancedScrape() {
  const result = await client.scrape('https://example.com', {
    format: 'markdown',
    waitForSelector: '.main-content',
    actions: [
      { type: 'click', selector: '.load-more' },
      { type: 'wait', timeout: 2000 }
    ]
  });
  
  console.log(result.content);
}
```

### LLM Extraction

```typescript
// Extract structured data using AI
async function extractProductData() {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Product name' },
      price: { type: 'string', description: 'Product price' },
      description: { type: 'string', description: 'Product description' },
      features: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['name', 'price']
  };
  
  const product = await client.scraper.extract(
    'https://shop.example.com/product',
    schema
  );
  
  console.log(product);
  // Output: { name: "...", price: "$99.99", description: "...", features: [...] }
}
```

### Crawling Operations

```typescript
// Start a crawl
async function crawlWebsite() {
  const crawl = await client.crawl('https://docs.example.com', {
    maxDepth: 3,
    limit: 100,
    includePatterns: ['/api/', '/guides/'],
    excludePatterns: ['/archive/'],
    useMapDiscovery: true,
    scrapeOptions: {
      format: 'markdown'
    }
  });
  
  console.log(`Crawl started: ${crawl.id}`);
  
  // Wait for completion
  const status = await crawl.waitForCompletion({
    timeout: 600000, // 10 minutes
    onProgress: (status) => {
      console.log(`Progress: ${status.completedUrls}/${status.totalUrls}`);
    }
  });
  
  console.log('Crawl completed:', status);
}

// Stream crawl results
async function streamCrawlResults() {
  const crawl = await client.crawler.start('https://example.com');
  
  for await (const page of client.crawler.stream(crawl.id)) {
    console.log(`Scraped: ${page.url}`);
    // Process each page as it completes
  }
}
```

### Batch Processing

```typescript
// Batch scraping
async function batchScrape() {
  const urls = [
    'https://example1.com',
    'https://example2.com',
    'https://example3.com'
  ];
  
  const batch = await client.batch.create(urls, {
    concurrency: 3,
    scrapeOptions: {
      format: 'markdown',
      timeout: 30000
    }
  });
  
  // Monitor progress
  const status = await batch.waitForCompletion({
    onProgress: (status) => {
      console.log(`Progress: ${status.progress}%`);
    }
  });
  
  // Download results as ZIP
  const zipBuffer = await client.batch.downloadZip(batch.id, 'markdown');
  fs.writeFileSync('results.zip', zipBuffer);
}

// Process large URL lists in chunks
async function processLargeList() {
  const urls = generateThousandsOfUrls();
  
  const results = await client.batch.processInChunks(urls, 100, {
    concurrency: 5,
    scrapeOptions: {
      format: 'text'
    }
  });
  
  console.log(`Processed ${results.length} URLs`);
}
```

### URL Discovery

```typescript
// Discover URLs
async function discoverUrls() {
  const discovery = await client.map.discover('https://example.com', {
    maxUrls: 10000,
    includeSubdomains: true,
    includePatterns: ['/blog/', '/docs/'],
    excludePatterns: ['/admin/', '/private/']
  });
  
  console.log(`Found ${discovery.total} URLs`);
  console.log('Discovery methods:', discovery.discoveryMethods);
  
  // Use discovered URLs for crawling
  const crawl = await client.crawl(discovery.links[0], {
    limit: discovery.total
  });
}

// Search-based discovery
async function searchAndScrape() {
  const discovery = await client.map.discover('https://docs.example.com', {
    searchQuery: 'authentication api',
    maxUrls: 100
  });
  
  // Scrape relevant pages
  for (const url of discovery.links.slice(0, 10)) {
    const result = await client.scrape(url);
    console.log(`Scraped: ${result.title}`);
  }
}
```

### Advanced Patterns

```typescript
// Custom retry logic
const client = new DeepScraperClient({
  apiKey: 'your-api-key',
  maxRetries: 5,
  retryDelay: 2000
});

// Event-driven crawling
async function eventDrivenCrawl() {
  const crawl = await client.crawler
    .start('https://example.com')
    .on('page', (page) => {
      console.log(`Scraped: ${page.url}`);
    })
    .on('error', (error, url) => {
      console.error(`Failed to scrape ${url}:`, error);
    })
    .on('complete', (stats) => {
      console.log('Crawl completed:', stats);
    })
    .execute();
}

// Webhook integration
async function webhookBatch() {
  const batch = await client.batch.create(urls, {
    webhook: 'https://your-server.com/webhook',
    webhookEvents: ['complete', 'error']
  });
}

// Progressive enhancement
async function progressiveScrapingr() {
  let result;
  
  try {
    // Try with JavaScript rendering
    result = await client.scrape(url, {
      javascript: true,
      waitForSelector: '.dynamic-content'
    });
  } catch (error) {
    // Fallback to simple HTTP
    result = await client.scrape(url, {
      javascript: false
    });
  }
  
  return result;
}
```

## Advanced Features

### 1. Streaming Support

```typescript
// src/http/stream.ts
export class StreamingClient {
  async *streamResults<T>(
    endpoint: string,
    params?: any
  ): AsyncGenerator<T> {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: this.headers,
      signal: this.abortController.signal
    });
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    if (!reader) throw new Error('No response body');
    
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          const data = JSON.parse(line);
          yield data as T;
        }
      }
    }
  }
}
```

### 2. Request Interceptors

```typescript
// Add custom headers
client.addInterceptor({
  request: (config) => {
    config.headers['X-Custom-Header'] = 'value';
    return config;
  }
});

// Log all requests
client.addInterceptor({
  request: (config) => {
    console.log(`Request: ${config.method} ${config.url}`);
    return config;
  },
  response: (response) => {
    console.log(`Response: ${response.status}`);
    return response;
  }
});
```

### 3. Caching

```typescript
// src/cache/memory.ts
export class MemoryCache {
  private cache = new Map<string, CacheEntry>();
  
  async get(key: string): Promise<any> {
    const entry = this.cache.get(key);
    
    if (!entry || entry.expiresAt < Date.now()) {
      return null;
    }
    
    return entry.value;
  }
  
  async set(key: string, value: any, ttl: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }
}

// Use with client
const client = new DeepScraperClient({
  apiKey: 'your-api-key',
  cache: new MemoryCache()
});
```

### 4. Middleware System

```typescript
// src/middleware/index.ts
export interface Middleware {
  name: string;
  pre?: (context: MiddlewareContext) => Promise<void>;
  post?: (context: MiddlewareContext) => Promise<void>;
}

// Rate limiting middleware
const rateLimitMiddleware: Middleware = {
  name: 'rateLimit',
  pre: async (context) => {
    await context.rateLimiter.acquire();
  }
};

// Logging middleware
const loggingMiddleware: Middleware = {
  name: 'logging',
  pre: async (context) => {
    console.log(`Starting ${context.operation}`);
    context.startTime = Date.now();
  },
  post: async (context) => {
    const duration = Date.now() - context.startTime;
    console.log(`Completed ${context.operation} in ${duration}ms`);
  }
};

// Use middleware
client.use(rateLimitMiddleware);
client.use(loggingMiddleware);
```

### 5. Plugin System

```typescript
// src/plugins/index.ts
export interface Plugin {
  name: string;
  version: string;
  install(client: DeepScraperClient): void;
}

// Analytics plugin
export const analyticsPlugin: Plugin = {
  name: 'analytics',
  version: '1.0.0',
  install(client) {
    client.on('request', (event) => {
      analytics.track('api_request', {
        endpoint: event.endpoint,
        method: event.method
      });
    });
  }
};

// Use plugin
client.use(analyticsPlugin);
```

## Testing Strategy

### Unit Tests

```typescript
// tests/unit/scraper.test.ts
import { ScraperResource } from '../../src/resources/scraper';
import { mockHttpClient } from '../mocks';

describe('ScraperResource', () => {
  let scraper: ScraperResource;
  
  beforeEach(() => {
    scraper = new ScraperResource(mockHttpClient);
  });
  
  test('should scrape URL successfully', async () => {
    mockHttpClient.post.mockResolvedValue({
      success: true,
      data: {
        url: 'https://example.com',
        content: 'Test content',
        contentType: 'html'
      }
    });
    
    const result = await scraper.scrape('https://example.com');
    
    expect(result.url).toBe('https://example.com');
    expect(result.content).toBe('Test content');
  });
  
  test('should handle errors properly', async () => {
    mockHttpClient.post.mockRejectedValue(
      new ApiError('Scraping failed', 500)
    );
    
    await expect(scraper.scrape('https://example.com'))
      .rejects.toThrow('Scraping failed');
  });
});
```

### Integration Tests

```typescript
// tests/integration/client.test.ts
import { DeepScraperClient } from '../../src';

describe('DeepScraperClient Integration', () => {
  let client: DeepScraperClient;
  
  beforeAll(() => {
    client = new DeepScraperClient({
      apiKey: process.env.TEST_API_KEY!,
      baseUrl: process.env.TEST_API_URL
    });
  });
  
  test('should perform end-to-end scraping', async () => {
    const result = await client.scrape('https://example.com', {
      format: 'markdown'
    });
    
    expect(result).toBeDefined();
    expect(result.contentType).toBe('markdown');
    expect(result.content.length).toBeGreaterThan(0);
  });
  
  test('should handle batch operations', async () => {
    const urls = [
      'https://example.com/page1',
      'https://example.com/page2'
    ];
    
    const batch = await client.batch.create(urls);
    const status = await batch.waitForCompletion({ timeout: 60000 });
    
    expect(status.completedUrls).toBe(2);
    expect(status.results).toHaveLength(2);
  });
});
```

### Mock Fixtures

```typescript
// tests/fixtures/responses.ts
export const mockScrapeResponse = {
  success: true,
  data: {
    url: 'https://example.com',
    title: 'Example Domain',
    content: '<h1>Example Domain</h1><p>This domain is for use in examples.</p>',
    contentType: 'html',
    metadata: {
      timestamp: '2024-01-01T00:00:00Z',
      status: 200,
      headers: {
        'content-type': 'text/html'
      }
    }
  }
};

export const mockCrawlResponse = {
  success: true,
  id: 'crawl-123',
  url: 'https://app.extractr.ai/api/crawl/crawl-123',
  message: 'Crawl initiated successfully'
};
```

## Publishing & Distribution

### NPM Publishing

```json
// package.json
{
  "name": "@deepscraper/node-sdk",
  "version": "1.0.0",
  "description": "Official Node.js SDK for DeepScraper API",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "prepublishOnly": "npm run clean && npm run build && npm run test",
    "clean": "rm -rf dist",
    "build": "tsc",
    "test": "jest",
    "release": "npm version patch && npm publish"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/extractr-ai/node-sdk.git"
  },
  "keywords": [
    "webscraping",
    "scraper",
    "crawler",
    "api",
    "sdk",
    "deepscraper"
  ],
  "publishConfig": {
    "access": "public"
  }
}
```

### Version Management

```bash
# Semantic versioning
npm version major  # Breaking changes
npm version minor  # New features
npm version patch  # Bug fixes

# Pre-release versions
npm version prerelease --preid=beta
# Results in: 1.0.0-beta.0

# Publish with tags
npm publish --tag beta
npm publish --tag latest
```

### Documentation

```markdown
# README.md

# DeepScraper Node.js SDK

Official Node.js SDK for the DeepScraper API.

## Installation

```bash
npm install @deepscraper/node-sdk
```

## Quick Start

```typescript
import { DeepScraperClient } from '@deepscraper/node-sdk';

const client = new DeepScraperClient({
  apiKey: 'your-api-key'
});

// Scrape a website
const result = await client.scrape('https://example.com', {
  format: 'markdown'
});

console.log(result.content);
```

## Documentation

Full documentation available at [https://docs.extractr.ai/sdk/node](https://docs.extractr.ai/sdk/node)
```

### CI/CD Pipeline

```yaml
# .github/workflows/publish.yml
name: Publish to NPM

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Build
        run: npm run build
      
      - name: Publish
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{secrets.NPM_TOKEN}}
```

## Best Practices

### 1. API Design Principles

- **Consistency**: All methods follow similar patterns
- **Predictability**: Clear method names and return types
- **Flexibility**: Options for both simple and complex use cases
- **Performance**: Built-in caching and connection pooling

### 2. Error Handling

- Always use custom error classes
- Provide meaningful error messages
- Include error codes for programmatic handling
- Preserve stack traces for debugging

### 3. Development Experience

- Comprehensive TypeScript types
- IntelliSense support in IDEs
- Detailed JSDoc comments
- Rich examples and documentation

### 4. Performance Optimization

- Connection pooling for HTTP requests
- Request deduplication
- Smart retry with exponential backoff
- Streaming for large datasets

### 5. Security

- API key validation
- HTTPS by default
- Request signing (future)
- Rate limiting awareness

## Future Enhancements

### 1. Advanced Features

- WebSocket support for real-time updates
- GraphQL API support
- Batch operations optimization
- Advanced caching strategies

### 2. Additional Integrations

- Proxy rotation support
- CAPTCHA solving integration
- Cloud storage uploads
- Webhook management

### 3. Developer Tools

- CLI tool for SDK
- VS Code extension
- Postman collection generator
- API playground

### 4. Performance Features

- Request compression
- Response caching
- Connection multiplexing
- Parallel request optimization

## Conclusion

The DeepScraper Node.js SDK provides a comprehensive, type-safe, and developer-friendly interface for web scraping and data extraction. With its modular architecture, extensive error handling, and rich feature set, it enables developers to build powerful scraping applications with minimal effort.

The SDK follows industry best practices and provides excellent developer experience through TypeScript support, comprehensive documentation, and intuitive APIs. It's designed to scale from simple single-page scraping to complex multi-site crawling operations while maintaining code clarity and reliability.