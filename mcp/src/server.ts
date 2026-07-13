#!/usr/bin/env node
/**
 * DeepScrape MCP Server
 * =====================
 *
 * A self-contained [Model Context Protocol](https://modelcontextprotocol.io)
 * stdio server that exposes DeepScrape's REST API as MCP tools, so AI agents
 * (Claude Desktop, Claude Code, Cursor, etc.) can scrape, map, crawl, and
 * search the web through DeepScrape.
 *
 * This process is a thin, network-only bridge: every tool simply calls the
 * DeepScrape HTTP API over `fetch` and returns the JSON response as text. It
 * holds no scraping logic of its own, so it can run anywhere that can reach the
 * DeepScrape server (`DEEPSCRAPE_API_URL`).
 *
 * ---------------------------------------------------------------------------
 * Build & run
 * ---------------------------------------------------------------------------
 *   1. Build the project:   npm run build      (compiles src -> dist via tsc)
 *   2. Start the server:    node dist/mcp/server.js
 *
 * The server speaks MCP over stdio: stdin/stdout are the protocol channel, so
 * ALL diagnostics are written to stderr. Never write to stdout directly.
 *
 * ---------------------------------------------------------------------------
 * Configuration (environment variables)
 * ---------------------------------------------------------------------------
 *   DEEPSCRAPE_API_URL   Base URL of the DeepScrape API. Default: http://localhost:3000
 *   DEEPSCRAPE_API_KEY   API key sent as the `X-API-Key` header on every request.
 *                        Optional (omit if the target server has DISABLE_AUTH=true).
 *
 * ---------------------------------------------------------------------------
 * Configuring it in an MCP client
 * ---------------------------------------------------------------------------
 * Add an entry to your client's MCP config (e.g. Claude Desktop's
 * `claude_desktop_config.json`, or a project-level `.mcp.json`):
 *
 *   {
 *     "mcpServers": {
 *       "deepscrape": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/deepscrape/dist/mcp/server.js"],
 *         "env": {
 *           "DEEPSCRAPE_API_URL": "http://localhost:3000",
 *           "DEEPSCRAPE_API_KEY": "your-api-key-here"
 *         }
 *       }
 *     }
 *   }
 *
 * Then restart the client; the `deepscrape_*` tools will appear.
 *
 * ---------------------------------------------------------------------------
 * Exposed tools
 * ---------------------------------------------------------------------------
 *   deepscrape_scrape          POST   /api/scrape                Scrape one URL -> markdown
 *   deepscrape_map             POST   /api/map                   Discover URLs on a site
 *   deepscrape_crawl           POST   /api/crawl                 Start a crawl (async)
 *   deepscrape_crawl_status    GET    /api/crawl/{id}            Poll crawl progress
 *   deepscrape_search          POST   /api/search                Web search (+ optional scrape)
 *   deepscrape_agent           POST   /api/agent                 Start an autonomous agent (async)
 *   deepscrape_agent_status    GET    /api/agent/{id}            Poll agent progress + result
 *   deepscrape_session_create  POST   /api/sessions              Open a persistent browser session
 *   deepscrape_session_action  POST   /api/sessions/{id}/action  Drive a session (navigate/click/...)
 *   deepscrape_session_close   DELETE /api/sessions/{id}         Close a session
 *   deepscrape_extract_auto    POST   /api/extract-auto          Self-healing structured extraction
 *   deepscrape_discover_apis   POST   /api/discover-apis         Find a page's hidden JSON/XHR APIs
 *
 * @packageDocumentation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Base URL of the DeepScrape REST API (trailing slashes trimmed). */
const API_URL = (process.env.DEEPSCRAPE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** API key sent as the `X-API-Key` header. Optional. */
const API_KEY = process.env.DEEPSCRAPE_API_KEY ?? '';

/** Maximum characters returned in a single tool result; very large bodies are truncated. */
const MAX_RESULT_CHARS = 100_000;

const SERVER_NAME = 'deepscrape';
const SERVER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// HTTP + result helpers
// ---------------------------------------------------------------------------

/** Shape of a text tool result. Structurally compatible with the SDK's CallToolResult. */
interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  // The SDK's CallToolResult carries an open index signature; include it so our
  // handler return type is assignable to what registerTool expects.
  [key: string]: unknown;
}

/** Wrap plain text as a successful tool result. */
function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] };
}

/** Wrap plain text as a failed tool result (isError: true). */
function errorResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Truncate a string to MAX_RESULT_CHARS, appending a marker when clipped. */
function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  const omitted = text.length - MAX_RESULT_CHARS;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n\n... [truncated ${omitted} characters]`;
}

/** Normalize an unknown error into a message string. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Call the DeepScrape REST API and convert the response into an MCP tool result.
 *
 * - Sends `Content-Type: application/json` and `X-API-Key` (when configured).
 * - On a network/transport failure, returns an error result.
 * - On a non-2xx response, returns an error result including the status and body.
 * - On success, pretty-prints JSON (falling back to raw text) and truncates to
 *   MAX_RESULT_CHARS.
 *
 * @param method HTTP method.
 * @param path   API path beginning with `/` (e.g. `/api/scrape`).
 * @param body   Optional JSON body for POST requests.
 */
async function callDeepScrape(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ToolTextResult> {
  const url = `${API_URL}${path}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // DNS failure, connection refused, timeout, etc.
    return errorResult(
      `Failed to reach DeepScrape API at ${method} ${url}: ${errorMessage(err)}. ` +
        `Check that the server is running and DEEPSCRAPE_API_URL is correct.`,
    );
  }

  const rawText = await response.text();

  if (!response.ok) {
    return errorResult(
      `DeepScrape API returned ${response.status} ${response.statusText} for ${method} ${path}:\n` +
        truncate(rawText || '(empty response body)'),
    );
  }

  // Pretty-print JSON when possible; otherwise return the raw body.
  let output: string;
  try {
    output = JSON.stringify(JSON.parse(rawText), null, 2);
  } catch {
    output = rawText;
  }

  return textResult(truncate(output));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register all DeepScrape tools on the given server.
 *
 * Note on tool-input schemas: `McpServer.registerTool` expects `inputSchema` to
 * be a *raw Zod shape* (a plain object mapping field names to Zod types) — NOT a
 * `z.object(...)`. The SDK wraps it internally and passes the parsed arguments
 * to the handler.
 */
function registerTools(server: McpServer): void {
  // -- deepscrape_scrape -----------------------------------------------------
  server.registerTool(
    'deepscrape_scrape',
    {
      title: 'Scrape a URL',
      description:
        'Scrape a single web page with DeepScrape and return its content as clean markdown. ' +
        'Best for reading one specific page.',
      inputSchema: {
        url: z.string().url().describe('The absolute http(s) URL to scrape.'),
        formats: z
          .array(z.string())
          .optional()
          .describe("Optional output formats: markdown, html, rawHtml, text, links, screenshot, pdf, mhtml, tables, contacts, changeTracking."),
        onlyMainContent: z
          .boolean()
          .optional()
          .describe('When true, strip navigation/boilerplate and return only the main content.'),
      },
    },
    async ({ url, formats, onlyMainContent }) => {
      // `formats` and `onlyMainContent` go inside `options`: the /api/scrape
      // route strips unknown top-level keys but passes `options` through.
      const options: Record<string, unknown> = { extractorFormat: 'markdown' };
      if (onlyMainContent !== undefined) options.onlyMainContent = onlyMainContent;
      if (formats !== undefined) options.formats = formats;

      return callDeepScrape('POST', '/api/scrape', { url, options });
    },
  );

  // -- deepscrape_map --------------------------------------------------------
  server.registerTool(
    'deepscrape_map',
    {
      title: 'Map a website',
      description:
        'Discover URLs on a website (via sitemaps, robots.txt, search, and crawling) and return ' +
        'the list of links found. Best for finding what pages exist before scraping or crawling.',
      inputSchema: {
        url: z.string().url().describe('The website URL to map / discover links from.'),
        maxUrls: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of URLs to discover.'),
        includeSubdomains: z
          .boolean()
          .optional()
          .describe('Include subdomains of the target host in discovery.'),
      },
    },
    async ({ url, maxUrls, includeSubdomains }) => {
      const requestBody: Record<string, unknown> = { url };
      if (maxUrls !== undefined) requestBody.maxUrls = maxUrls;
      if (includeSubdomains !== undefined) requestBody.includeSubdomains = includeSubdomains;

      return callDeepScrape('POST', '/api/map', requestBody);
    },
  );

  // -- deepscrape_crawl ------------------------------------------------------
  server.registerTool(
    'deepscrape_crawl',
    {
      title: 'Crawl a website',
      description:
        'Start an asynchronous crawl of a website. Returns a crawl id and a status URL; poll ' +
        'progress with `deepscrape_crawl_status`. Best for extracting many pages under a site.',
      inputSchema: {
        url: z.string().url().describe('The starting URL to crawl.'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of pages to crawl.'),
        maxDepth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum link depth from the starting URL.'),
        useMapDiscovery: z
          .boolean()
          .optional()
          .describe('Use streaming map-based URL discovery for faster, broader coverage.'),
      },
    },
    async ({ url, limit, maxDepth, useMapDiscovery }) => {
      const requestBody: Record<string, unknown> = { url };
      if (limit !== undefined) requestBody.limit = limit;
      if (maxDepth !== undefined) requestBody.maxDepth = maxDepth;
      if (useMapDiscovery !== undefined) requestBody.useMapDiscovery = useMapDiscovery;

      return callDeepScrape('POST', '/api/crawl', requestBody);
    },
  );

  // -- deepscrape_crawl_status ----------------------------------------------
  server.registerTool(
    'deepscrape_crawl_status',
    {
      title: 'Get crawl status',
      description:
        'Check the progress and status of a crawl started with `deepscrape_crawl`, using its ' +
        'crawl id. Returns completion counts and per-page results as they finish.',
      inputSchema: {
        crawlId: z.string().min(1).describe('The crawl id returned by deepscrape_crawl.'),
      },
    },
    async ({ crawlId }) => {
      return callDeepScrape('GET', `/api/crawl/${encodeURIComponent(crawlId)}`);
    },
  );

  // -- deepscrape_search -----------------------------------------------------
  server.registerTool(
    'deepscrape_search',
    {
      title: 'Search the web',
      description:
        'Run a web search through DeepScrape and return the results, optionally scraping the ' +
        'content of each result page. Best for research when you do not have a specific URL.',
      inputSchema: {
        query: z.string().min(1).describe('The search query.'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of search results to return.'),
        scrapeResults: z
          .boolean()
          .optional()
          .describe('When true, scrape and include the content of each result page.'),
      },
    },
    async ({ query, limit, scrapeResults }) => {
      const requestBody: Record<string, unknown> = { query };
      if (limit !== undefined) requestBody.limit = limit;
      if (scrapeResults !== undefined) requestBody.scrapeResults = scrapeResults;

      return callDeepScrape('POST', '/api/search', requestBody);
    },
  );

  // -- deepscrape_agent ------------------------------------------------------
  server.registerTool(
    'deepscrape_agent',
    {
      title: 'Run an autonomous web agent',
      description:
        'Start an autonomous navigation agent toward a natural-language goal. The agent drives a ' +
        'real browser (navigate/click/type) starting from `url` until it can answer, then returns a ' +
        'structured (schema) or textual answer. Runs asynchronously: this returns a task id — poll it ' +
        'with `deepscrape_agent_status`. Requires the DeepScrape server to have an LLM key configured.',
      inputSchema: {
        url: z.string().url().describe('The starting URL for the agent.'),
        prompt: z.string().min(1).describe('The natural-language goal to accomplish.'),
        schema: z
          .record(z.any())
          .optional()
          .describe('Optional JSON Schema for a structured final answer; omit for a text answer.'),
        maxSteps: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe('Maximum navigation steps (default 8, capped at 20).'),
      },
    },
    async ({ url, prompt, schema, maxSteps }) => {
      const requestBody: Record<string, unknown> = { url, prompt };
      if (schema !== undefined) requestBody.schema = schema;
      if (maxSteps !== undefined) requestBody.maxSteps = maxSteps;

      return callDeepScrape('POST', '/api/agent', requestBody);
    },
  );

  // -- deepscrape_agent_status ----------------------------------------------
  server.registerTool(
    'deepscrape_agent_status',
    {
      title: 'Get agent status',
      description:
        'Check the status and result of an agent run started with `deepscrape_agent`, using its task ' +
        'id. When completed, returns the steps taken and the final answer/data.',
      inputSchema: {
        taskId: z.string().min(1).describe('The task id returned by deepscrape_agent.'),
      },
    },
    async ({ taskId }) => {
      return callDeepScrape('GET', `/api/agent/${encodeURIComponent(taskId)}`);
    },
  );

  // -- deepscrape_session_create --------------------------------------------
  server.registerTool(
    'deepscrape_session_create',
    {
      title: 'Create a browser session',
      description:
        'Open a persistent interactive browser session and return its id. The session keeps a live ' +
        'browser context (cookies/auth/JS state persist) so you can drive it step by step with ' +
        '`deepscrape_session_action`. Close it with `deepscrape_session_close` when done. Best for ' +
        'multi-step or authenticated flows.',
      inputSchema: {
        initialUrl: z.string().url().optional().describe('Optional URL to navigate to on creation.'),
        userAgent: z.string().optional().describe('Optional custom User-Agent for the session.'),
      },
    },
    async ({ initialUrl, userAgent }) => {
      const requestBody: Record<string, unknown> = {};
      if (initialUrl !== undefined) requestBody.initialUrl = initialUrl;
      if (userAgent !== undefined) requestBody.userAgent = userAgent;

      return callDeepScrape('POST', '/api/sessions', requestBody);
    },
  );

  // -- deepscrape_session_action --------------------------------------------
  server.registerTool(
    'deepscrape_session_action',
    {
      title: 'Run a session action',
      description:
        'Perform one action against a session created with `deepscrape_session_create`. Supported ' +
        'types: navigate (url), click (selector), type/fill (selector + text), select (selector + ' +
        'value), scroll (position), waitForSelector (selector), wait (timeout), screenshot (fullPage), ' +
        'scrape (formats -> markdown/html/text/links of the current page), evaluate (script), back, ' +
        'forward, reload, content. Returns the action result plus the updated session state.',
      inputSchema: {
        sessionId: z.string().min(1).describe('The session id from deepscrape_session_create.'),
        type: z
          .enum([
            'navigate', 'click', 'type', 'fill', 'select', 'scroll', 'waitForSelector',
            'wait', 'screenshot', 'scrape', 'evaluate', 'back', 'forward', 'reload', 'content',
          ])
          .describe('The action to perform.'),
        url: z.string().url().optional().describe('Target URL (for navigate).'),
        selector: z.string().optional().describe('CSS selector (for click/type/fill/select/waitForSelector).'),
        text: z.string().optional().describe('Text to enter (for type/fill).'),
        value: z.string().optional().describe('Value to set (for select), or alias for text.'),
        formats: z
          .array(z.string())
          .optional()
          .describe("For scrape: subset of ['markdown','html','rawHtml','text','links']."),
        script: z.string().optional().describe('JavaScript to run (for evaluate; gated server-side).'),
        timeout: z.number().int().min(0).optional().describe('Timeout in ms (for wait / per-action).'),
        fullPage: z.boolean().optional().describe('Capture the full page (for screenshot).'),
      },
    },
    async ({ sessionId, type, url, selector, text, value, formats, script, timeout, fullPage }) => {
      const action: Record<string, unknown> = { type };
      if (url !== undefined) action.url = url;
      if (selector !== undefined) action.selector = selector;
      if (text !== undefined) action.text = text;
      if (value !== undefined) action.value = value;
      if (formats !== undefined) action.formats = formats;
      if (script !== undefined) action.script = script;
      if (timeout !== undefined) action.timeout = timeout;
      if (fullPage !== undefined) action.fullPage = fullPage;

      return callDeepScrape('POST', `/api/sessions/${encodeURIComponent(sessionId)}/action`, action);
    },
  );

  // -- deepscrape_session_close ---------------------------------------------
  server.registerTool(
    'deepscrape_session_close',
    {
      title: 'Close a browser session',
      description:
        'Close a session created with `deepscrape_session_create` and free its browser context. ' +
        'Always close sessions when finished so they do not count against the session limit.',
      inputSchema: {
        sessionId: z.string().min(1).describe('The session id to close.'),
      },
    },
    async ({ sessionId }) => {
      return callDeepScrape('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`);
    },
  );

  // -- deepscrape_extract_auto ----------------------------------------------
  server.registerTool(
    'deepscrape_extract_auto',
    {
      title: 'Self-healing structured extraction',
      description:
        'Extract structured data from a page by describing the fields you want — no CSS selectors ' +
        'needed. An LLM derives robust selectors once, they are cached, and subsequent calls run ' +
        'deterministically; when the site changes and the selectors stop yielding data, it ' +
        're-derives automatically. Best for structured data you scrape repeatedly (listings, ' +
        'catalogs, tables) that you want to keep working as the site evolves.',
      inputSchema: {
        url: z.string().url().describe('The page to extract from.'),
        fields: z
          .array(
            z.object({
              name: z.string().describe('Field name in the output records.'),
              description: z.string().optional().describe('What this field is, to guide selector derivation.'),
              type: z
                .enum(['text', 'attribute', 'html', 'number', 'list'])
                .optional()
                .describe('Value type (default text).'),
              required: z.boolean().optional().describe('If true, empty values across records signal breakage → re-derive.'),
            }),
          )
          .min(1)
          .describe('The fields to extract (name + optional description/type/required).'),
        forceReheal: z.boolean().optional().describe('Ignore any cached schema and re-derive selectors now.'),
      },
    },
    async ({ url, fields, forceReheal }) => {
      const body: Record<string, unknown> = { url, fields };
      if (forceReheal !== undefined) body.forceReheal = forceReheal;
      return callDeepScrape('POST', '/api/extract-auto', body);
    },
  );

  // -- deepscrape_discover_apis ---------------------------------------------
  server.registerTool(
    'deepscrape_discover_apis',
    {
      title: 'Discover a page\'s hidden APIs',
      description:
        'Load a page in a real browser and return the JSON/XHR/fetch endpoints it calls under the ' +
        'hood. JS-heavy sites almost always pull their data from a JSON or GraphQL API — querying ' +
        'that endpoint directly is far cheaper and more stable than scraping the rendered HTML. Use ' +
        'this to find the API behind a page before scraping it.',
      inputSchema: {
        url: z.string().url().describe('The page whose backing API calls you want to discover.'),
        includeNonJson: z
          .boolean()
          .optional()
          .describe('Also include non-JSON XHR/fetch calls (default: JSON-like only).'),
      },
    },
    async ({ url, includeNonJson }) => {
      const body: Record<string, unknown> = { url };
      if (includeNonJson !== undefined) body.includeNonJson = includeNonJson;
      return callDeepScrape('POST', '/api/discover-apis', body);
    },
  );
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr only — stdout is the MCP protocol channel.
  console.error(
    `[${SERVER_NAME}] MCP server v${SERVER_VERSION} started on stdio ` +
      `(DeepScrape API: ${API_URL}${API_KEY ? ', API key configured' : ', no API key'}).`,
  );
}

// Run immediately, surfacing any startup failure to stderr with a non-zero exit.
void (async () => {
  try {
    await main();
  } catch (err) {
    console.error(`[${SERVER_NAME}] Fatal error during startup:`, err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  }
})();
