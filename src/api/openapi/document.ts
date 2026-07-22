import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as S from '../schemas';

/**
 * Builds the OpenAPI document from the zod request schemas in `src/api/schemas`.
 *
 * The schemas here are the SAME objects the route handlers validate with, so a
 * change to request validation shows up in the spec on the next generate. Run
 * `npm run openapi:generate` to refresh `swagger.yaml`; `npm run openapi:check`
 * (and the openapi.spec.ts test) fail if the committed file is stale or if an
 * endpoint exists in the code but is missing here.
 *
 * NOTE: this module is excluded from the production `tsc` build (see tsconfig)
 * because @asteasolutions/zod-to-openapi is a devDependency.
 */
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  name: 'X-API-Key',
  in: 'header',
  description: 'API key. Required on every /api/* route.',
});

const AUTH = [{ ApiKeyAuth: [] as string[] }];

// --- common response shapes -------------------------------------------------

const errorResponse = z
  .object({ success: z.literal(false), error: z.string() })
  .openapi('ErrorResponse');

const okResponse = z
  .object({ success: z.literal(true) })
  .passthrough()
  .openapi('SuccessResponse');

const asyncJobResponse = z
  .object({
    success: z.literal(true),
    id: z.string(),
    url: z.string().describe('Polling URL for this job'),
    status: z.string(),
  })
  .openapi('AsyncJobAccepted');

const jsonBody = (schema: z.ZodTypeAny) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const pathParam = (name: string, description: string) =>
  z.object({ [name]: z.string().openapi({ description }) });

/** Standard response block: 200 + auth/validation/error codes. */
const responses = (okSchema: z.ZodTypeAny, okDescription = 'Success') => ({
  200: {
    description: okDescription,
    content: { 'application/json': { schema: okSchema } },
  },
  400: {
    description: 'Invalid request',
    content: { 'application/json': { schema: errorResponse } },
  },
  401: {
    description: 'Missing or invalid API key',
    content: { 'application/json': { schema: errorResponse } },
  },
  429: {
    description: 'Rate limit or quota exceeded',
    content: { 'application/json': { schema: errorResponse } },
  },
});

const withNotFound = (base: ReturnType<typeof responses>) => ({
  ...base,
  404: {
    description: 'Not found',
    content: { 'application/json': { schema: errorResponse } },
  },
});

type PathArgs = {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  tag: string;
  summary: string;
  description?: string;
  body?: z.ZodTypeAny;
  params?: z.AnyZodObject;
  query?: z.AnyZodObject;
  ok?: z.ZodTypeAny;
  okDescription?: string;
  notFound?: boolean;
  public?: boolean;
  rawContent?: { type: string; description: string };
};

function add(a: PathArgs) {
  const base = responses(a.ok ?? okResponse, a.okDescription);
  const res: Record<string, unknown> = a.notFound ? withNotFound(base) : base;
  if (a.rawContent) {
    res[200] = {
      description: a.rawContent.description,
      content: { [a.rawContent.type]: { schema: z.string() } },
    };
  }
  registry.registerPath({
    method: a.method,
    path: a.path,
    tags: [a.tag],
    summary: a.summary,
    description: a.description,
    security: a.public ? undefined : AUTH,
    request: {
      ...(a.body ? jsonBody(a.body) : {}),
      ...(a.params ? { params: a.params } : {}),
      ...(a.query ? { query: a.query } : {}),
    },
    responses: res as never,
  });
}

// ---------------------------------------------------------------------------
// Scrape
// ---------------------------------------------------------------------------
add({ method: 'post', path: '/api/scrape', tag: 'Scrape', summary: 'Scrape a URL to markdown, HTML, text or structured data', body: S.scrapeRequestSchema });
add({ method: 'post', path: '/api/scrape/async', tag: 'Scrape', summary: 'Submit a scrape as an async job', body: S.scrapeAsyncRequestSchema, ok: asyncJobResponse, okDescription: 'Job accepted' });
add({ method: 'get', path: '/api/scrape/job/{id}', tag: 'Scrape', summary: 'Poll an async scrape job', params: pathParam('id', 'Async scrape job id'), notFound: true });
add({ method: 'post', path: '/api/extract-schema', tag: 'Scrape', summary: 'Extract structured data using a JSON Schema (LLM)', body: S.extractSchemaRequestSchema });
add({ method: 'post', path: '/api/summarize', tag: 'Scrape', summary: 'Scrape a URL and generate an AI summary', body: S.summarizeRequestSchema });
add({ method: 'delete', path: '/api/cache', tag: 'Scrape', summary: 'Invalidate the scrape cache (all, or a single URL)', body: S.cacheInvalidateSchema });

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------
add({ method: 'post', path: '/api/crawl', tag: 'Crawl', summary: 'Start a multi-page crawl', body: S.crawlRequestSchema, ok: asyncJobResponse, okDescription: 'Crawl started' });
add({ method: 'post', path: '/api/crawl/estimate', tag: 'Crawl', summary: 'Pre-run size/cost estimate for a crawl', body: S.crawlEstimateSchema });
add({ method: 'get', path: '/api/crawl/active', tag: 'Crawl', summary: 'List currently-active crawls' });
add({ method: 'get', path: '/api/crawl/{jobId}', tag: 'Crawl', summary: 'Get crawl status and exported files', params: pathParam('jobId', 'Crawl job id'), notFound: true });
add({ method: 'get', path: '/api/crawl/{jobId}/errors', tag: 'Crawl', summary: 'List per-page failures for a crawl', params: pathParam('jobId', 'Crawl job id'), notFound: true });
add({ method: 'get', path: '/api/crawl/{jobId}/stream', tag: 'Crawl', summary: 'Stream crawl pages as Server-Sent Events', params: pathParam('jobId', 'Crawl job id'), rawContent: { type: 'text/event-stream', description: 'SSE stream of pages as they complete' } });
add({ method: 'get', path: '/api/crawl/{jobId}/download/zip', tag: 'Crawl', summary: 'Download all crawled pages as a ZIP', params: pathParam('jobId', 'Crawl job id'), query: z.object({ format: z.enum(['markdown', 'json']).optional() }), rawContent: { type: 'application/zip', description: 'ZIP archive of crawled pages' } });
add({ method: 'get', path: '/api/crawl/{jobId}/download/json', tag: 'Crawl', summary: 'Download all crawled pages as one JSON array', params: pathParam('jobId', 'Crawl job id') });
add({ method: 'delete', path: '/api/crawl/{jobId}', tag: 'Crawl', summary: 'Cancel a running crawl', params: pathParam('jobId', 'Crawl job id'), notFound: true });

// ---------------------------------------------------------------------------
// Batch scrape
// ---------------------------------------------------------------------------
const batchId = pathParam('batchId', 'Batch id (UUID)');
add({ method: 'post', path: '/api/batch/scrape', tag: 'Batch', summary: 'Scrape many URLs concurrently', body: S.batchScrapeRequestSchema, ok: asyncJobResponse, okDescription: 'Batch accepted' });
add({ method: 'get', path: '/api/batch/scrape/{batchId}/status', tag: 'Batch', summary: 'Batch progress and results', params: batchId, notFound: true });
add({ method: 'get', path: '/api/batch/scrape/{batchId}/errors', tag: 'Batch', summary: 'Per-URL failures for a batch', params: batchId, notFound: true });
add({ method: 'get', path: '/api/batch/scrape/{batchId}/download/zip', tag: 'Batch', summary: 'Download batch results as a ZIP', params: batchId, rawContent: { type: 'application/zip', description: 'ZIP archive of batch results' } });
add({ method: 'get', path: '/api/batch/scrape/{batchId}/download/json', tag: 'Batch', summary: 'Download batch results as JSON', params: batchId, notFound: true });
add({ method: 'get', path: '/api/batch/scrape/{batchId}/download/{jobId}', tag: 'Batch', summary: 'Download a single result from a batch', params: z.object({ batchId: z.string().openapi({ description: 'Batch id (UUID)' }), jobId: z.string().openapi({ description: 'Job id within the batch' }) }), notFound: true });
add({ method: 'delete', path: '/api/batch/scrape/{batchId}', tag: 'Batch', summary: 'Cancel a batch', params: batchId, notFound: true });
add({ method: 'post', path: '/api/batch/cleanup', tag: 'Batch', summary: 'Clean up batch records older than N days', query: z.object({ days: z.coerce.number().int().min(1).max(365).optional() }) });

// ---------------------------------------------------------------------------
// Map (URL discovery)
// ---------------------------------------------------------------------------
add({ method: 'post', path: '/api/map', tag: 'Map', summary: 'Discover all URLs on a site', body: S.mapRequestSchema });
add({ method: 'get', path: '/api/map/health', tag: 'Map', summary: 'URL-discovery subsystem health' });
add({ method: 'get', path: '/api/map/cache/stats', tag: 'Map', summary: 'URL-discovery cache statistics' });
add({ method: 'post', path: '/api/map/cache/clear', tag: 'Map', summary: 'Clear the URL-discovery cache for a site', body: S.mapClearCacheSchema });

// ---------------------------------------------------------------------------
// Search / async tasks / tools
// ---------------------------------------------------------------------------
add({ method: 'post', path: '/api/search', tag: 'Search', summary: 'Web search, optionally scraping each result', body: S.searchRequestSchema });
add({ method: 'post', path: '/api/extract', tag: 'Extract', summary: 'Async multi-URL LLM extraction', body: S.extractTaskSchema, ok: asyncJobResponse, okDescription: 'Job accepted' });
add({ method: 'get', path: '/api/extract/{id}', tag: 'Extract', summary: 'Poll an extract job', params: pathParam('id', 'Extract job id'), notFound: true });
add({ method: 'post', path: '/api/extract-auto', tag: 'Extract', summary: 'Self-healing extraction — derives and caches CSS selectors, re-derives on breakage', body: S.extractAutoSchema });
add({ method: 'post', path: '/api/llmstxt', tag: 'Tools', summary: 'Generate an llms.txt for a site', body: S.llmstxtSchema, ok: asyncJobResponse, okDescription: 'Job accepted' });
add({ method: 'get', path: '/api/llmstxt/{id}', tag: 'Tools', summary: 'Poll an llms.txt job', params: pathParam('id', 'llms.txt job id'), notFound: true });
add({ method: 'post', path: '/api/parse', tag: 'Tools', summary: 'Parse a document (PDF/DOCX/…) to markdown', body: S.parseRequestSchema });
add({ method: 'post', path: '/api/discover-apis', tag: 'Tools', summary: 'Surface a page’s underlying JSON/XHR endpoints', body: S.discoverApisSchema });
add({ method: 'get', path: '/api/reader', tag: 'Tools', summary: 'Scrape a URL to markdown; honours Accept: text/markdown', query: z.object({ url: z.string().url().openapi({ description: 'URL to read' }) }) });
add({ method: 'get', path: '/api/usage', tag: 'Ops', summary: 'API key usage and quota' });
add({ method: 'get', path: '/api/proxies', tag: 'Ops', summary: 'Proxy pool health' });

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------
add({ method: 'post', path: '/api/agent', tag: 'Agent', summary: 'Autonomous navigation toward a natural-language goal', body: S.agentRequestSchema, ok: asyncJobResponse, okDescription: 'Job accepted' });
add({ method: 'get', path: '/api/agent/{id}', tag: 'Agent', summary: 'Poll an agent run', params: pathParam('id', 'Agent task id'), notFound: true });

// ---------------------------------------------------------------------------
// Persistent browser sessions
// ---------------------------------------------------------------------------
const sessionId = pathParam('id', 'Session id');
add({ method: 'post', path: '/api/sessions', tag: 'Sessions', summary: 'Create a persistent browser session', body: S.sessionCreateSchema });
add({ method: 'get', path: '/api/sessions', tag: 'Sessions', summary: 'List active sessions' });
add({ method: 'get', path: '/api/sessions/{id}', tag: 'Sessions', summary: 'Get a session', params: sessionId, notFound: true });
add({ method: 'post', path: '/api/sessions/{id}/action', tag: 'Sessions', summary: 'Run an action in a session (navigate, click, scrape, …)', body: S.sessionActionSchema, params: sessionId, notFound: true });
add({ method: 'delete', path: '/api/sessions/{id}', tag: 'Sessions', summary: 'Close a session', params: sessionId, notFound: true });

// ---------------------------------------------------------------------------
// Site specs (site -> MCP endpoint)
// ---------------------------------------------------------------------------
const siteId = pathParam('id', 'Site spec id');
add({ method: 'post', path: '/api/sites', tag: 'Sites', summary: 'Create a reusable site spec (becomes an MCP tool)', body: S.siteCreateSchema });
add({ method: 'get', path: '/api/sites', tag: 'Sites', summary: 'List site specs' });
add({ method: 'get', path: '/api/sites/{id}', tag: 'Sites', summary: 'Get a site spec', params: siteId, notFound: true });
add({ method: 'post', path: '/api/sites/{id}/run', tag: 'Sites', summary: 'Run a site spec by id', body: S.siteRunSchema, params: siteId, notFound: true });
add({ method: 'post', path: '/api/sites/by-name/{name}/run', tag: 'Sites', summary: 'Run a site spec by name', body: S.siteRunSchema, params: pathParam('name', 'Site spec name (slug)'), notFound: true });
add({ method: 'post', path: '/api/sites/{id}/verify', tag: 'Sites', summary: 'Verify a spec still extracts correctly (self-heals on drift)', params: siteId, notFound: true });
add({ method: 'delete', path: '/api/sites/{id}', tag: 'Sites', summary: 'Delete a site spec', params: siteId, notFound: true });

// ---------------------------------------------------------------------------
// Ops (no API key)
// ---------------------------------------------------------------------------
add({ method: 'get', path: '/health', tag: 'Ops', summary: 'Liveness probe', public: true });
add({ method: 'get', path: '/health/ready', tag: 'Ops', summary: 'Readiness probe (dependencies reachable)', public: true });
add({
  method: 'get', path: '/metrics', tag: 'Ops', summary: 'Prometheus metrics', public: true,
  rawContent: { type: 'text/plain', description: 'Prometheus exposition format' },
});

/** Build the OpenAPI 3.0 document. */
export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'DeepScraper API',
      version: '1.0.0',
      description:
        'Open-source web scraping API — scrape, crawl, map, search, extract structured data, ' +
        'drive persistent browser sessions, and expose any site as a reusable endpoint.\n\n' +
        'This file is GENERATED from the zod request schemas in `src/api/schemas`. ' +
        'Do not edit by hand — run `npm run openapi:generate`.',
      license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local instance' }],
  });
}

export { registry };
