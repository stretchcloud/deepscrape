# DeepScrape SDK

A tiny, dependency-free, typed TypeScript client for the [DeepScrape](../README.md) API.

- **Zero dependencies** — uses the global `fetch` (Node 18+).
- **Self-contained** — one file (`sdk/src/index.ts`), defines its own types, imports nothing from the server.
- **Typed** — full JSDoc, a typed `DeepScrapeError`, and async-generator SSE streaming.

## Requirements

Node **18+** (for global `fetch`, `ReadableStream`, and `TextDecoder`). Works in any modern runtime that provides those globals, or pass your own `fetchImpl`.

## Install

The SDK is a single self-contained module. Copy `sdk/src/index.ts` into your project (or publish it as a package) and import it:

```ts
import { DeepScrapeClient, DeepScrapeError } from './sdk/src';
```

## Quick start

```ts
import { DeepScrapeClient } from './sdk/src';

const client = new DeepScrapeClient({
  baseUrl: 'http://localhost:3000', // optional, this is the default
  apiKey: process.env.DEEPSCRAPE_API_KEY!,
});

const page = await client.scrape('https://example.com', { onlyMainContent: true });
console.log(page.title, page.content);
```

Every request sends `X-API-Key: <apiKey>` and `Content-Type: application/json`. Any non-2xx response throws a [`DeepScrapeError`](#error-handling).

## API

| Method | HTTP | Description |
| --- | --- | --- |
| `scrape(url, options?)` | `POST /api/scrape` | Scrape a single URL. Body: `{ url, options }`. |
| `map(url, options?)` | `POST /api/map` | Discover URLs on a site. Body: `{ url, ...options }`. |
| `search(query, options?)` | `POST /api/search` | Run a search query. Body: `{ query, ...options }`. |
| `startCrawl(url, options?)` | `POST /api/crawl` | Start a crawl job. Returns `{ id, url, ... }`. |
| `getCrawlStatus(crawlId)` | `GET /api/crawl/:id` | Get crawl status and results. |
| `cancelCrawl(crawlId)` | `DELETE /api/crawl/:id` | Cancel a running crawl. |
| `downloadCrawlZip(crawlId)` | `GET /api/crawl/:id/download/zip` | Download completed pages as a ZIP (`ArrayBuffer`). |
| `streamCrawl(crawlId)` | `GET /api/crawl/:id/stream` | Async-generator over SSE events. |
| `waitForCrawl(crawlId, opts?)` | polls `getCrawlStatus` | Resolve when the crawl is `completed`/`cancelled`. |

## Examples

### Scrape

```ts
const result = await client.scrape('https://example.com', {
  onlyMainContent: true,
  extractorFormat: 'markdown',
});
console.log(result.content);
```

### Map (URL discovery)

```ts
const { data } = await client.map('https://docs.example.com', {
  maxUrls: 200,
  includeSubdomains: true,
  searchQuery: 'api reference',
});
console.log(`Discovered ${data.total} URLs`);
```

### Search

```ts
const results = await client.search('typescript web scraping', { limit: 10 });
console.log(results);
```

### Crawl + `waitForCrawl`

```ts
const { id } = await client.startCrawl('https://example.com', {
  limit: 100,
  maxDepth: 3,
});

// Poll every 2s (default) until the crawl finishes, or reject after 30 min.
const final = await client.waitForCrawl(id, { pollMs: 2000, timeoutMs: 10 * 60_000 });
console.log(`Crawl ${final.status}: ${final.progress.completed} pages`);

// Grab everything as a ZIP once done.
const zip = await client.downloadCrawlZip(id); // ArrayBuffer
// e.g. in Node: fs.writeFileSync('crawl.zip', Buffer.from(zip));
```

### Stream a crawl (SSE)

`streamCrawl` yields `{ event, data }` frames as pages complete and stops after the `done` event. Breaking out of the loop early cancels the underlying connection.

```ts
const { id } = await client.startCrawl('https://example.com', { limit: 50 });

for await (const evt of client.streamCrawl(id)) {
  switch (evt.event) {
    case 'page':
      console.log('scraped', evt.data.url);
      break;
    case 'progress':
      console.log(`${evt.data.completed}/${evt.data.total}`);
      break;
    case 'done':
      console.log('finished:', evt.data.status);
      break;
  }
}
```

## Error handling

Non-2xx responses throw a `DeepScrapeError` carrying the HTTP `status` and parsed `body`:

```ts
import { DeepScrapeError } from './sdk/src';

try {
  await client.scrape('https://example.com');
} catch (err) {
  if (err instanceof DeepScrapeError) {
    console.error(`HTTP ${err.status}`, err.body);
  } else {
    throw err;
  }
}
```

## Custom `fetch`

Inject any `fetch`-compatible implementation — handy for tests, proxies, or older runtimes:

```ts
const client = new DeepScrapeClient({
  apiKey: 'key',
  fetchImpl: myFetch, // e.g. a mock, or `node-fetch`
});
```

## Types

Exported types: `DeepScrapeOptions`, `DeepScrapeStreamEvent<T>`, `WaitForCrawlOptions`, `DeepScrapeError`, and the `DEFAULT_BASE_URL` constant. Response payloads are returned as `any` (they mirror the server's JSON), so cast to your own interfaces as needed.
