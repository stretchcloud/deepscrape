import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { DeepScrapeClient, DeepScrapeError } from './index';

/**
 * These tests never touch the network. A mock `fetchImpl` is injected through
 * the constructor and returns hand-built `Response`-like objects.
 */

// Reach for runtime globals via `globalThis` so the spec type-checks regardless
// of which TS `lib` the test runner is configured with. All exist on Node 18+.
const g = globalThis as any;

/** A minimal Response-like object backing JSON endpoints. */
function makeJsonResponse(body: unknown, status = 200, statusText = 'OK'): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
    async arrayBuffer() {
      return new g.TextEncoder().encode(JSON.stringify(body)).buffer;
    },
    body: null,
  };
}

/** Build a WHATWG ReadableStream that emits one string chunk per pull. */
function streamFromChunks(chunks: string[]): any {
  const encoder = new g.TextEncoder();
  let i = 0;
  return new g.ReadableStream({
    pull(controller: any) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** A Response-like object whose body is an SSE stream built from `chunks`. */
function makeStreamResponse(chunks: string[]): any {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: streamFromChunks(chunks),
    async text() {
      return '';
    },
  };
}

describe('DeepScrapeClient', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  describe('constructor', () => {
    it('throws when no apiKey is provided', () => {
      expect(() => new DeepScrapeClient({ apiKey: '' })).toThrow(TypeError);
    });
  });

  describe('scrape()', () => {
    it('POSTs to the right URL with the API key header and returns JSON', async () => {
      const responseBody = {
        success: true,
        url: 'https://example.com',
        title: 'Example',
        content: '# Example',
        contentType: 'markdown',
        metadata: { status: 200 },
      };
      mockFetch.mockResolvedValue(makeJsonResponse(responseBody));

      const client = new DeepScrapeClient({
        apiKey: 'secret-key',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const result = await client.scrape('https://example.com', { onlyMainContent: true });

      // Returns the parsed JSON body verbatim.
      expect(result).toEqual(responseBody);

      // Exactly one request, to the expected URL, with the expected shape.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:3000/api/scrape');
      expect(init.method).toBe('POST');
      expect(init.headers['X-API-Key']).toBe('secret-key');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        url: 'https://example.com',
        options: { onlyMainContent: true },
      });
    });

    it('honours a custom baseUrl (trailing slash trimmed)', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ success: true }));
      const client = new DeepScrapeClient({
        apiKey: 'k',
        baseUrl: 'https://api.deepscrape.dev/',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      await client.scrape('https://example.com');

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.deepscrape.dev/api/scrape');
    });
  });

  describe('request() error handling', () => {
    it('throws a DeepScrapeError carrying status and body on 500', async () => {
      const errBody = { success: false, error: 'Internal server error' };
      mockFetch.mockResolvedValue(makeJsonResponse(errBody, 500, 'Internal Server Error'));

      const client = new DeepScrapeClient({
        apiKey: 'k',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect.assertions(4);
      try {
        await client.scrape('https://example.com');
      } catch (err) {
        expect(err).toBeInstanceOf(DeepScrapeError);
        const e = err as DeepScrapeError;
        expect(e.status).toBe(500);
        expect(e.body).toEqual(errBody);
        expect(e.message).toContain('500');
      }
    });
  });

  describe('crawl endpoint wiring', () => {
    it('startCrawl POSTs a flattened body and getCrawlStatus/cancelCrawl use the id path', async () => {
      const client = new DeepScrapeClient({
        apiKey: 'k',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      mockFetch.mockResolvedValue(makeJsonResponse({ success: true, id: 'job-1' }));
      await client.startCrawl('https://example.com', { limit: 50, maxDepth: 3 });
      let [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/crawl');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        url: 'https://example.com',
        limit: 50,
        maxDepth: 3,
      });

      mockFetch.mockResolvedValue(makeJsonResponse({ success: true, status: 'scraping' }));
      await client.getCrawlStatus('job-1');
      [url, init] = mockFetch.mock.calls[1];
      expect(url).toBe('http://localhost:3000/api/crawl/job-1');
      expect(init.method).toBe('GET');

      mockFetch.mockResolvedValue(makeJsonResponse({ success: true }));
      await client.cancelCrawl('job-1');
      [url, init] = mockFetch.mock.calls[2];
      expect(url).toBe('http://localhost:3000/api/crawl/job-1');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('streamCrawl()', () => {
    it('parses an SSE stream and yields events, stopping after "done"', async () => {
      const chunks = [
        'event: open\ndata: {"crawlId":"abc"}\n\n',
        'event: page\ndata: {"url":"https://a.com","title":"A"}\n\n',
        'event: progress\ndata: {"completed":1,"total":2}\n\n',
        // The `done` frame is followed by a stray `page` frame that must be ignored.
        'event: done\ndata: {"status":"completed"}\n\nevent: page\ndata: {"url":"https://late.com"}\n\n',
      ];
      mockFetch.mockResolvedValue(makeStreamResponse(chunks));

      const client = new DeepScrapeClient({
        apiKey: 'k',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const events: Array<{ event: string; data: any }> = [];
      for await (const evt of client.streamCrawl('abc')) {
        events.push(evt);
      }

      expect(events.map((e) => e.event)).toEqual(['open', 'page', 'progress', 'done']);
      expect(events[1].data).toEqual({ url: 'https://a.com', title: 'A' });
      expect(events[3].data).toEqual({ status: 'completed' });

      // Correct endpoint + SSE Accept header.
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/crawl/abc/stream');
      expect(init.method).toBe('GET');
      expect(init.headers['Accept']).toBe('text/event-stream');
    });

    it('buffers frames split across chunks and joins multi-line data', async () => {
      const chunks = [
        'event: pa', // event name split across chunks
        'ge\ndata: {"url":"http://b.com",\n', // data line 1 (JSON continues on next data line)
        'data: "title":"B"}\n\n', // data line 2 -> joined with "\n"
        'event: done\nda', // done frame split
        'ta: {"status":"completed"}\n\n',
      ];
      mockFetch.mockResolvedValue(makeStreamResponse(chunks));

      const client = new DeepScrapeClient({
        apiKey: 'k',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const events: Array<{ event: string; data: any }> = [];
      for await (const evt of client.streamCrawl('abc')) {
        events.push(evt);
      }

      expect(events.map((e) => e.event)).toEqual(['page', 'done']);
      expect(events[0].data).toEqual({ url: 'http://b.com', title: 'B' });
    });
  });

  describe('downloadCrawlZip()', () => {
    it('returns the response bytes as an ArrayBuffer', async () => {
      const bytes = new g.TextEncoder().encode('PKzip-bytes');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        async arrayBuffer() {
          return bytes.buffer;
        },
      });

      const client = new DeepScrapeClient({
        apiKey: 'k',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const buf = await client.downloadCrawlZip('job-1');
      expect(buf).toBe(bytes.buffer);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://localhost:3000/api/crawl/job-1/download/zip',
      );
    });
  });

  describe('waitForCrawl()', () => {
    it('polls until the crawl reaches a terminal status', async () => {
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({ success: true, status: 'scraping' }))
        .mockResolvedValueOnce(makeJsonResponse({ success: true, status: 'scraping' }))
        .mockResolvedValueOnce(makeJsonResponse({ success: true, status: 'completed' }));

      const client = new DeepScrapeClient({
        apiKey: 'k',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const final = await client.waitForCrawl('job-1', { pollMs: 1, timeoutMs: 5000 });
      expect(final.status).toBe('completed');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('rejects when the timeout elapses before completion', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ success: true, status: 'scraping' }));

      const client = new DeepScrapeClient({
        apiKey: 'k',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      await expect(
        client.waitForCrawl('job-1', { pollMs: 10, timeoutMs: 5 }),
      ).rejects.toThrow(/Timed out/);
    });
  });
});
