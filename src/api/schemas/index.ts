import { z } from 'zod';

/**
 * Request schemas for every documented endpoint — the single source of truth for
 * BOTH runtime validation (the route handlers import these) and the generated
 * OpenAPI spec (`src/api/openapi` imports these).
 *
 * This module must stay PURE: it may only import `zod`. The OpenAPI generator
 * imports it directly, and pulling in a route/controller/service here would drag
 * in Redis, BullMQ and the browser pool — all of which open handles at import
 * time and would hang the generator.
 *
 * Adding a request field? Add it here and it appears in the spec automatically.
 */

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** A scripted browser interaction performed before content is captured. */
export const browserActionSchema = z.object({
  type: z.enum(['click', 'scroll', 'wait', 'fill', 'select']),
  selector: z.string().optional(),
  value: z.string().optional(),
  position: z.number().optional(),
  timeout: z.number().optional(),
  optional: z.boolean().optional(),
});

/** Render/extraction options accepted by `POST /api/scrape`. */
export const scrapeOptionsSchema = z.object({
  waitForSelector: z.string().optional(),
  waitForTimeout: z.number().int().positive().optional(),
  actions: z.array(browserActionSchema).optional(),
  skipCache: z.boolean().optional(),
  cacheTtl: z.number().int().positive().optional(),
  extractorFormat: z.enum(['html', 'markdown', 'text']).optional(),
  onlyMainContent: z.boolean().optional(),
  fitMarkdown: z.boolean().optional(),
  useBrowser: z.boolean().optional(),
  stealthMode: z.boolean().optional(),
  skipTlsVerification: z.boolean().optional(),
  // Extraction options (LLM or deterministic CSS) — validated downstream.
  extractionOptions: z.any().optional(),
  // Allow forward-compatible scraper options through to the manager.
});

/** A field the caller wants extracted, used by extract-auto and site specs. */
export const desiredFieldSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['text', 'attribute', 'html', 'number', 'list', 'nested', 'nested_list']).optional(),
  attribute: z.string().max(100).optional(),
  required: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Scrape
// ---------------------------------------------------------------------------

export const scrapeRequestSchema = z.object({
  url: z.string().url(),
  options: scrapeOptionsSchema.passthrough().optional(),
});

export const scrapeAsyncRequestSchema = z.object({
  url: z.string().url(),
  options: scrapeOptionsSchema.passthrough().optional(),
});

export const extractSchemaRequestSchema = z.object({
  url: z.string().url(),
  schema: z.object({}).passthrough(), // Allow any JSON Schema object
  options: z
    .object({
      waitForSelector: z.string().optional(),
      waitForTimeout: z.number().int().positive().optional(),
      actions: z.array(browserActionSchema).optional(),
      skipCache: z.boolean().optional(),
      cacheTtl: z.number().int().positive().optional(),
      extractorFormat: z.enum(['html', 'markdown', 'text']).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
      instructions: z.string().optional(),
    })
    .optional(),
});

export const summarizeRequestSchema = z.object({
  url: z.string().url(),
  maxLength: z.number().int().positive().optional(), // Maximum length of summary in words
  options: z
    .object({
      waitForSelector: z.string().optional(),
      waitForTimeout: z.number().int().positive().optional(),
      actions: z.array(browserActionSchema).optional(),
      skipCache: z.boolean().optional(),
      cacheTtl: z.number().int().positive().optional(),
      extractorFormat: z.enum(['html', 'markdown', 'text']).optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
});

export const cacheInvalidateSchema = z.object({
  url: z.string().optional(), // If provided, invalidate only this URL
});

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

/**
 * Mirrors `validateCrawlRequest` (crawl-validation.middleware.ts), which also
 * CLAMPS numeric values to the MAX_CRAWL_* env limits rather than rejecting.
 */
export const crawlRequestSchema = z.object({
  url: z.string().url(),
  limit: z.number().int().positive().optional(),
  maxUrls: z.number().int().positive().optional(),
  maxDepth: z.number().int().min(0).optional(),
  maxDiscoveryDepth: z.number().int().min(0).optional(),
  webhook: z.string().url().optional(),
  includePaths: z.array(z.string()).optional(),
  excludePaths: z.array(z.string()).optional(),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  crawlOptions: z
    .object({
      maxConcurrentCrawlers: z.number().int().positive().optional(),
      browserPoolSize: z.number().int().positive().optional(),
    })
    .passthrough()
    .optional(),
  scrapeOptions: z.record(z.any()).optional(),
});

export const crawlEstimateSchema = z.object({
  url: z.string().url().optional(),
  limit: z.number().int().positive().optional(),
  maxDepth: z.number().int().min(0).optional(),
  scrapeOptions: z.record(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// Batch scrape (validated at runtime by express-validator; mirrored here)
// ---------------------------------------------------------------------------

export const batchScrapeRequestSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(100),
  concurrency: z.number().int().min(1).max(10).optional(),
  webhook: z.string().url().optional(),
  timeout: z.number().int().min(10000).optional(),
  failFast: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  options: z
    .object({
      timeout: z.number().int().min(1000).max(300000).optional(),
      userAgent: z.string().max(500).optional(),
      waitForTimeout: z.number().int().min(0).max(60000).optional(),
    })
    .passthrough()
    .optional(),
});

// ---------------------------------------------------------------------------
// Map (URL discovery)
// ---------------------------------------------------------------------------

export const mapRequestSchema = z.object({
  url: z.string().url('Invalid URL format'),
  maxUrls: z.number().int().min(1).max(30000).optional().default(5000),
  includeSubdomains: z.boolean().optional().default(true),
  searchQuery: z.string().optional(),
  skipSitemaps: z.boolean().optional().default(false),
  sitemapsOnly: z.boolean().optional().default(false),
  useUrlIndex: z.boolean().optional().default(true),
  timeoutMs: z.number().int().min(1000).max(300000).optional().default(30000),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});

export const mapClearCacheSchema = z.object({
  url: z.string().url('Invalid URL format'),
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().positive().max(50).optional(),
  provider: z.enum(['duckduckgo', 'searxng', 'serper']).optional(),
  lang: z.string().max(10).optional(),
  // When true, scrape each result and attach markdown content.
  scrapeResults: z.boolean().optional(),
  scrapeOptions: z.record(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// Async tasks: extract + llms.txt
// ---------------------------------------------------------------------------

export const extractTaskSchema = z.object({
  urls: z.array(z.string().url()).max(1000).optional(),
  url: z.string().url().optional(),
  prompt: z.string().max(5000).optional(),
  schema: z.any().optional(),
  limit: z.number().int().positive().max(1000).optional(),
  scrapeOptions: z.record(z.any()).optional(),
});

export const llmstxtSchema = z.object({
  url: z.string().url(),
  maxUrls: z.number().int().positive().max(500).optional(),
  includeFullText: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Self-healing extraction
// ---------------------------------------------------------------------------

export const extractAutoSchema = z.object({
  url: z.string().url(),
  fields: z.array(desiredFieldSchema).min(1).max(50),
  cssSchema: z.any().optional(), // optional bootstrap schema (skips first LLM derivation)
  forceReheal: z.boolean().optional(),
  scrapeOptions: z.record(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const agentRequestSchema = z.object({
  url: z.string().url(),
  prompt: z.string().min(1).max(5000),
  schema: z.any().optional(),
  maxSteps: z.number().int().positive().max(20).optional(),
  onlyMainContent: z.boolean().optional(),
  fitMarkdown: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Persistent browser sessions
// ---------------------------------------------------------------------------

export const SESSION_ACTION_TYPES = [
  'navigate', 'click', 'type', 'fill', 'select', 'scroll', 'waitForSelector',
  'wait', 'screenshot', 'scrape', 'evaluate', 'back', 'forward', 'reload', 'content',
] as const;

export const sessionCreateSchema = z.object({
  userAgent: z.string().max(500).optional(),
  viewport: z
    .object({
      width: z.number().int().min(200).max(4000),
      height: z.number().int().min(200).max(4000),
    })
    .optional(),
  initialUrl: z.string().url().optional(),
  proxy: z
    .object({
      server: z.string().max(300),
      username: z.string().max(200).optional(),
      password: z.string().max(200).optional(),
    })
    .optional(),
});

export const sessionActionSchema = z.object({
  type: z.enum(SESSION_ACTION_TYPES),
  url: z.string().url().optional(),
  selector: z.string().max(2000).optional(),
  value: z.string().optional(),
  text: z.string().optional(),
  position: z.number().optional(),
  timeout: z.number().int().min(0).max(120000).optional(),
  script: z.string().max(20000).optional(),
  fullPage: z.boolean().optional(),
  formats: z.array(z.string()).max(6).optional(),
  onlyMainContent: z.boolean().optional(),
  fitMarkdown: z.boolean().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
});

// ---------------------------------------------------------------------------
// Site specs (site -> MCP endpoint generator)
// ---------------------------------------------------------------------------

export const siteParamSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
});

export const siteCreateSchema = z.object({
  name: z.string().min(1).max(48),
  description: z.string().max(500).optional(),
  url: z.string().min(1).max(2000),
  params: z.array(siteParamSchema).max(20).optional(),
  fields: z.array(desiredFieldSchema).min(1).max(50),
  cssSchema: z.any().optional(),
  sampleParams: z.record(z.any()).optional(),
  sessionId: z.string().max(100).optional(),
  verify: z.boolean().optional(),
});

export const siteRunSchema = z.object({ params: z.record(z.any()).optional() });

// ---------------------------------------------------------------------------
// Misc tools
// ---------------------------------------------------------------------------

export const parseRequestSchema = z.object({
  content: z.string().optional(), // base64
  url: z.string().url().optional(),
  contentType: z.string().max(100).optional(),
});

export const discoverApisSchema = z.object({
  url: z.string().url(),
  timeout: z.number().int().min(1000).max(120000).optional(),
  includeNonJson: z.boolean().optional(),
});
