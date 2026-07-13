/**
 * DeepScrape SDK — a tiny, dependency-free, typed client for the DeepScrape API.
 *
 * Targets Node 18+ and relies solely on the global WHATWG `fetch` /
 * `ReadableStream` / `TextDecoder`. It defines its own types and does not import
 * anything from the DeepScrape server codebase, so it can be published or copied
 * on its own.
 *
 * @example
 * ```ts
 * import { DeepScrapeClient } from './sdk/src';
 *
 * const client = new DeepScrapeClient({ apiKey: process.env.DEEPSCRAPE_API_KEY! });
 * const page = await client.scrape('https://example.com');
 * console.log(page.title);
 * ```
 *
 * @packageDocumentation
 */

/** Default base URL used when {@link DeepScrapeOptions.baseUrl} is omitted. */
export const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Options accepted by the {@link DeepScrapeClient} constructor. */
export interface DeepScrapeOptions {
  /** Base URL of the DeepScrape server. Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** API key sent in the `X-API-Key` header on every request. Required. */
  apiKey: string;
  /**
   * Custom `fetch` implementation. Defaults to the global `fetch`. Primarily
   * useful for injecting a mock in tests or a polyfill in older runtimes.
   */
  fetchImpl?: typeof fetch;
}

/**
 * A single Server-Sent-Event frame produced by {@link DeepScrapeClient.streamCrawl}.
 *
 * `event` is the SSE event name — one of `open`, `page`, `progress`, `done` or
 * `error` for the crawl stream — and `data` is the parsed JSON payload (or the
 * raw string if the payload was not valid JSON).
 */
export interface DeepScrapeStreamEvent<T = any> {
  /** SSE event name (e.g. `page`, `progress`, `done`). */
  event: string;
  /** Parsed JSON payload for the event, or the raw string when not JSON. */
  data: T;
}

/** Options for {@link DeepScrapeClient.waitForCrawl}. */
export interface WaitForCrawlOptions {
  /** Interval between status polls, in milliseconds. Default `2000`. */
  pollMs?: number;
  /** Overall timeout before rejecting, in milliseconds. Default `1800000` (30 min). */
  timeoutMs?: number;
}

/**
 * Error thrown when the DeepScrape API responds with a non-2xx status.
 *
 * Carries the HTTP {@link DeepScrapeError.status | status} code and the parsed
 * response {@link DeepScrapeError.body | body} (JSON object when possible,
 * otherwise the raw text, otherwise `null`).
 */
export class DeepScrapeError extends Error {
  /** HTTP status code of the failing response (`0` for non-HTTP failures). */
  readonly status: number;
  /** Parsed response body: a JSON value, a raw string, or `null`. */
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'DeepScrapeError';
    this.status = status;
    this.body = body;
    // Restore the prototype chain so `instanceof` works when the class is
    // transpiled down to ES5/ES2015 (TypeScript `target`).
    Object.setPrototypeOf(this, DeepScrapeError.prototype);
  }
}

/**
 * Read a `Response` body once, returning parsed JSON when possible, the raw
 * text when it is not JSON, or `null` when the body is empty.
 */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Locate the earliest SSE frame boundary (a blank line) in `buffer`.
 * Handles `\n\n`, `\r\n\r\n` and `\r\r` line-ending styles.
 */
function findFrameBoundary(buffer: string): { index: number; length: number } | null {
  let index = -1;
  let length = 0;
  for (const sep of ['\r\n\r\n', '\n\n', '\r\r']) {
    const at = buffer.indexOf(sep);
    if (at !== -1 && (index === -1 || at < index)) {
      index = at;
      length = sep.length;
    }
  }
  return index === -1 ? null : { index, length };
}

/**
 * Parse a single raw SSE frame into a {@link DeepScrapeStreamEvent}.
 *
 * Supports multi-line frames and multiple `data:` lines (concatenated with
 * `\n`, per the SSE spec). Returns `null` for comment-only / empty frames.
 */
function parseSseFrame(frame: string): DeepScrapeStreamEvent | null {
  const lines = frame.split(/\r\n|\r|\n/);
  let event = 'message';
  const dataLines: string[] = [];
  let hasContent = false;

  for (const line of lines) {
    // Blank lines and comment lines (starting with ':') carry no field.
    if (line === '' || line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      // A single leading space after the colon is part of the format, not data.
      if (value.startsWith(' ')) value = value.slice(1);
    }

    if (field === 'event') {
      event = value;
      hasContent = true;
    } else if (field === 'data') {
      dataLines.push(value);
      hasContent = true;
    }
    // `id` and `retry` fields are intentionally ignored.
  }

  if (!hasContent) return null;

  const dataStr = dataLines.join('\n');
  let data: unknown = dataStr;
  if (dataStr.length > 0) {
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = dataStr;
    }
  }
  return { event, data };
}

/**
 * Typed client for the DeepScrape HTTP API.
 *
 * Every method maps to a single endpoint and returns the parsed JSON response
 * (or, for downloads, an `ArrayBuffer`). Non-2xx responses reject with a
 * {@link DeepScrapeError}.
 */
export class DeepScrapeClient {
  /** Normalized base URL (no trailing slash). */
  private readonly baseUrl: string;
  /** API key sent as `X-API-Key`. */
  private readonly apiKey: string;
  /** Resolved fetch implementation (global `fetch` unless overridden). */
  private readonly fetchImpl: typeof fetch;

  /**
   * Create a new client.
   *
   * @param opts - Connection options. {@link DeepScrapeOptions.apiKey} is required.
   * @throws {TypeError} If no API key is supplied, or if no `fetch` is available.
   */
  constructor(opts: DeepScrapeOptions) {
    if (!opts || !opts.apiKey) {
      throw new TypeError('DeepScrapeClient requires an `apiKey`.');
    }
    const impl = opts.fetchImpl ?? (globalThis as any).fetch;
    if (typeof impl !== 'function') {
      throw new TypeError(
        'No `fetch` implementation available. Use Node 18+ or pass `fetchImpl`.',
      );
    }
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = impl;
  }

  /**
   * Perform a raw request and return the `Response` on success (2xx). Rejects
   * with a {@link DeepScrapeError} on any non-2xx status. The response body is
   * left unread so callers can stream it, read it as JSON, or read it as bytes.
   *
   * @internal
   */
  private async fetchRaw(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    // Call through a local binding so the fetch runs with `this === undefined`,
    // which the native `fetch` requires (avoids "Illegal invocation").
    const doFetch = this.fetchImpl;
    const res = await doFetch(url, init);

    if (!res.ok) {
      const errBody = await readBody(res);
      throw new DeepScrapeError(
        `DeepScrape request failed: ${method} ${path} -> ${res.status} ${res.statusText}`,
        res.status,
        errBody,
      );
    }
    return res;
  }

  /**
   * Perform a request and parse the JSON response.
   *
   * @typeParam T - Expected shape of the parsed response.
   * @throws {DeepScrapeError} On any non-2xx response.
   * @internal
   */
  private async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchRaw(method, path, body);
    return (await readBody(res)) as T;
  }

  /**
   * Scrape a single URL.
   *
   * `POST /api/scrape` with body `{ url, options }`.
   *
   * @param url - The absolute URL to scrape.
   * @param options - Optional scraper options (forwarded verbatim under `options`).
   * @returns The scrape result (`{ success, url, title, content, contentType, metadata, ... }`).
   * @throws {DeepScrapeError} On a non-2xx response.
   */
  scrape(url: string, options?: Record<string, any>): Promise<any> {
    return this.request('POST', '/api/scrape', { url, options });
  }

  /**
   * Discover URLs on a site (sitemaps, search, crawling, common paths).
   *
   * `POST /api/map` with body `{ url, ...options }`.
   *
   * @param url - The site URL to map.
   * @param options - Optional discovery options (e.g. `maxUrls`, `includeSubdomains`,
   *                  `searchQuery`, `includePatterns`), spread onto the request body.
   * @returns The discovery result (`{ success, data: { links, total, ... }, metadata }`).
   * @throws {DeepScrapeError} On a non-2xx response.
   */
  map(url: string, options?: Record<string, any>): Promise<any> {
    return this.request('POST', '/api/map', { url, ...(options ?? {}) });
  }

  /**
   * Run a search query.
   *
   * `POST /api/search` with body `{ query, ...options }`.
   *
   * @param query - The search query string.
   * @param options - Optional search options, spread onto the request body.
   * @returns The search result payload.
   * @throws {DeepScrapeError} On a non-2xx response.
   */
  search(query: string, options?: Record<string, any>): Promise<any> {
    return this.request('POST', '/api/search', { query, ...(options ?? {}) });
  }

  /**
   * Start an asynchronous crawl job.
   *
   * `POST /api/crawl` with body `{ url, ...options }`.
   *
   * @param url - The seed URL to crawl.
   * @param options - Optional crawl options (e.g. `limit`, `maxDepth`, `includePaths`,
   *                  `scrapeOptions`, `useMapDiscovery`), spread onto the request body.
   * @returns The kickoff response, including the crawl `id` and a status `url`.
   * @throws {DeepScrapeError} On a non-2xx response.
   */
  startCrawl(url: string, options?: Record<string, any>): Promise<any> {
    return this.request('POST', '/api/crawl', { url, ...(options ?? {}) });
  }

  /**
   * Fetch the current status and results of a crawl job.
   *
   * `GET /api/crawl/:crawlId`.
   *
   * @param crawlId - The crawl id returned by {@link startCrawl}.
   * @returns The status payload (`{ success, status, crawl, jobs, progress, ... }`),
   *          where `status` is `'scraping' | 'completed' | 'cancelled'`.
   * @throws {DeepScrapeError} On a non-2xx response (e.g. 404 for an unknown id).
   */
  getCrawlStatus(crawlId: string): Promise<any> {
    return this.request('GET', `/api/crawl/${encodeURIComponent(crawlId)}`);
  }

  /**
   * Cancel a running crawl job.
   *
   * `DELETE /api/crawl/:crawlId`.
   *
   * @param crawlId - The crawl id to cancel.
   * @returns `{ success: true }` on success.
   * @throws {DeepScrapeError} On a non-2xx response.
   */
  cancelCrawl(crawlId: string): Promise<any> {
    return this.request('DELETE', `/api/crawl/${encodeURIComponent(crawlId)}`);
  }

  /**
   * Download all completed crawl pages as a ZIP archive.
   *
   * `GET /api/crawl/:crawlId/download/zip`.
   *
   * @param crawlId - The crawl id whose pages to download.
   * @returns The raw ZIP bytes as an `ArrayBuffer`.
   * @throws {DeepScrapeError} On a non-2xx response.
   */
  async downloadCrawlZip(crawlId: string): Promise<ArrayBuffer> {
    const res = await this.fetchRaw(
      'GET',
      `/api/crawl/${encodeURIComponent(crawlId)}/download/zip`,
    );
    return res.arrayBuffer();
  }

  /**
   * Stream crawl results as they arrive over Server-Sent Events.
   *
   * `GET /api/crawl/:crawlId/stream`. Yields one {@link DeepScrapeStreamEvent}
   * per SSE frame — `open`, `page`, `progress`, and finally `done` — and stops
   * after the `done` event. If the consumer stops iterating early, the
   * underlying connection is cancelled.
   *
   * @param crawlId - The crawl id to stream.
   * @yields Parsed SSE events (`{ event, data }`).
   * @throws {DeepScrapeError} On a non-2xx response, or if the body is not readable.
   *
   * @example
   * ```ts
   * for await (const evt of client.streamCrawl(id)) {
   *   if (evt.event === 'page') console.log('scraped', evt.data.url);
   * }
   * ```
   */
  async *streamCrawl(crawlId: string): AsyncGenerator<DeepScrapeStreamEvent, void, unknown> {
    const res = await this.fetchRaw(
      'GET',
      `/api/crawl/${encodeURIComponent(crawlId)}/stream`,
      undefined,
      { Accept: 'text/event-stream' },
    );

    if (!res.body) {
      throw new DeepScrapeError('Response body is not readable for SSE stream', res.status, null);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Emit every complete frame currently buffered.
        let boundary = findFrameBoundary(buffer);
        while (boundary) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          const evt = parseSseFrame(frame);
          if (evt) {
            yield evt;
            if (evt.event === 'done') return;
          }
          boundary = findFrameBoundary(buffer);
        }
      }

      // Flush any trailing bytes and a final frame with no trailing blank line.
      buffer += decoder.decode();
      const evt = parseSseFrame(buffer);
      if (evt) yield evt;
    } finally {
      // Cancel (rather than release) so an early consumer break closes the socket.
      try {
        await reader.cancel();
      } catch {
        /* stream already closed — ignore */
      }
    }
  }

  /**
   * Poll {@link getCrawlStatus} until the crawl finishes.
   *
   * Resolves with the final status payload once `status` becomes `'completed'`
   * or `'cancelled'`. Rejects if the timeout elapses first.
   *
   * @param crawlId - The crawl id to wait on.
   * @param opts - Polling controls; see {@link WaitForCrawlOptions}.
   * @returns The terminal status payload.
   * @throws {Error} If the crawl does not finish within `timeoutMs`.
   * @throws {DeepScrapeError} If a status poll returns a non-2xx response.
   */
  async waitForCrawl(crawlId: string, opts?: WaitForCrawlOptions): Promise<any> {
    const pollMs = opts?.pollMs ?? 2000;
    const timeoutMs = opts?.timeoutMs ?? 30 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const status = await this.getCrawlStatus(crawlId);
      const state = status?.status;
      if (state === 'completed' || state === 'cancelled') {
        return status;
      }
      // Stop before sleeping past the deadline (avoids a useless extra poll).
      if (Date.now() + pollMs >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for crawl ${crawlId} to finish ` +
            `(last status: ${state ?? 'unknown'}).`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export default DeepScrapeClient;
