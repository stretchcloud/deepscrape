# 📚 DeepScrape – Intelligent Web Scraping & LLM-Powered Extraction

> **AI-powered web scraping with intelligent extraction**

Transform any website into structured data using Playwright automation and GPT-4o extraction. Built for modern web applications, RAG pipelines, and data workflows.

## ✨ Features

- **✨ Fit-Markdown Extraction** - pruning content filter (link-density scoring) for clean, LLM-ready markdown
- **🎯 Deterministic CSS Extraction** - Structured data via CSS selectors, no LLM cost or hallucination
- **🤖 LLM Extraction** - Convert web content to structured JSON using OpenAI, with token-aware chunking + schema validation
- **📝 Multi-Format Output** - `markdown` + `html` + `rawHtml` + `text` + `links` + `screenshot` + `pdf` + `mhtml` + `tables` + `changeTracking` in a single request
- **📄 Document Parsing** - `/api/parse` converts PDF / DOCX / HTML files to markdown (magic-byte sniffing, SSRF-guarded)
- **🔀 Change Tracking** - `changeTracking` format diffs a page against its previous scrape (git-style diff + added/removed lines)
- **🧠 Multi-URL Extract** - Async `/api/extract` pulls structured data across many pages against one schema
- **🩹 Self-Healing Extraction** - `/api/extract-auto` derives CSS selectors once, caches them, runs deterministically, and re-derives when the site breaks
- **🎚️ Confidence Signals** - LLM extraction grounds each field against the source and flags hallucination (suspect) + omission (missing)
- **🥷 Fingerprint Hygiene** - Consistent browser fingerprints + automation-leak patching (not CAPTCHA-solving; robots.txt respected)
- **🕹️ Interactive Sessions** - `/api/sessions` keeps a browser context alive to drive step by step (navigate/click/type/scrape)
- **🤖 Autonomous Agent** - `/api/agent` navigates a site toward a natural-language goal and returns a structured answer
- **🔁 Proxy Rotation** - Configurable egress-proxy pool for the browser path with health tracking + escalation
- **📃 llms.txt Generator** - `/api/llmstxt` builds an `llms.txt` (and `llms-full.txt`) index for any site
- **🔌 Site → MCP Endpoint** - `/api/sites` turns any site into a saved, self-healing extraction endpoint; each becomes its own `site_<name>` MCP tool for agents
- **🔎 Error Introspection** - `/api/crawl/active`, `/crawl/:id/errors`, `/batch/scrape/:id/errors`, and `/api/usage`
- **🔍 Web Search** - `/api/search` (Serper / SearXNG / DuckDuckGo) with optional scrape-of-results
- **🕷️ Web Crawling** - True multi-level crawl with best-first URL scoring, robots.txt, live status, cancel
- **📡 Live Streaming** - Server-Sent Events stream crawl pages as they complete; ZIP/JSON downloads over HTTP
- **🗺️ URL Discovery** - `/map` endpoint discovering thousands of URLs in seconds, **including subdomains**
- **🛡️ SSRF-Hardened** - DNS-resolving guard blocks private/metadata IPs on every fetch and redirect hop
- **🚦 Rate Limits & Quotas** - Per-key rate limiting + per-key daily quotas
- **📊 Observability** - Prometheus `/metrics`, liveness + readiness probes
- **🧩 MCP Server** - Model Context Protocol server so AI agents (Claude, Cursor, …) can use DeepScrape as tools
- **📦 Node SDK** - Typed client with `streamCrawl` and `waitForCrawl` helpers
- **📦 Batch Processing** - Process multiple URLs efficiently with controlled concurrency
- **🎭 Browser Automation** - Playwright with stealth mode, plus a fast HTTP path for server-rendered sites
- **⚡ Smart Caching** - File-based caching with configurable TTL
- **🔄 Job Queue** - Background processing with BullMQ and Redis; `ROLE=web|worker` split for horizontal scaling
- **🐳 Docker Ready** - Hardened one-command deployment (managed-Redis ready, non-root, tini)

> 📖 **New to this version?** Jump to the [Feature Guide](#-feature-guide-new-capabilities) below for usage of every new capability.

## 🚀 Quick Start

### 1. Installation

```bash
git clone https://github.com/stretchcloud/deepscrape.git
cd deepscrape
npm install
cp .env.example .env
```

### 2. Configuration

Edit `.env` with your settings:

```env
API_KEY=your-secret-key
OPENAI_API_KEY=your-openai-key
REDIS_HOST=localhost
CACHE_ENABLED=true
```

### 3. Start Server

```bash
npm run dev
```

Test: `curl http://localhost:3000/health`

⚡ **New**: Enhanced crawling with `useMapDiscovery: true` - discover 1000+ URLs in seconds instead of minutes!

---

## 🧭 Feature Guide (New Capabilities)

All examples assume the API is running at `http://localhost:3000` and use an API key via the `X-API-Key` header. Set your key with `API_KEY=...` in `.env`.

```bash
export API_KEY="your-secret-key"
export BASE="http://localhost:3000"
```

### 1. Scrape output formats

**Fit-markdown (default).** Scraping to markdown now uses a *pruning content filter* that scores each DOM node (with **link-density** as the key signal) to strip nav/footer/ads/boilerplate while preserving headings, tables, and code. It's on by default for markdown.

```bash
curl -s -X POST "$BASE/api/scrape" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","options":{"extractorFormat":"markdown"}}'
```

Relevant `options`:

| Option | Default | Description |
|---|---|---|
| `extractorFormat` | `html` | `markdown` \| `html` \| `text` |
| `onlyMainContent` | `true` | Strip nav/boilerplate; `false` keeps the whole page |
| `fitMarkdown` | `true` | Use the pruning content filter (set `false` for the legacy heuristic) |

**Multi-format — get everything in one call.** Pass `formats` to return several representations at once under a `formats` object. `screenshot` is returned as a base64 PNG data-URI (forces a browser render).

```bash
curl -s -X POST "$BASE/api/scrape" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","options":{"formats":["markdown","html","rawHtml","text","links","screenshot"]}}'
```

```jsonc
{
  "success": true,
  "url": "https://example.com",
  "formats": {
    "markdown": "# Example Domain\n\n...",
    "html": "<div><h1>Example Domain</h1>...",   // cleaned/pruned HTML
    "rawHtml": "<!doctype html>...",              // untouched source
    "text": "Example Domain This domain is ...",
    "links": ["https://www.iana.org/domains/example"],
    "screenshot": "data:image/png;base64,iVBORw0K..."
  }
}
```

Supported formats: `markdown`, `html`, `rawHtml`, `text`, `links`, `screenshot`, `pdf`, `mhtml`, `tables`, `contacts`, `changeTracking`.

**`contacts`.** Deterministic (no-LLM) extraction of `emails`, `phones`, and `socials` (twitter/linkedin/facebook/instagram/youtube/github/tiktok) from a page — for lead-gen / contact enrichment.

**`pdf` / `mhtml` / `tables`.** `pdf` renders the page to a PDF (base64 `data:application/pdf` URI); `mhtml` captures a single-file MHTML archive (the exact bytes, for offline/forensic use); `tables` returns every HTML `<table>` as structured JSON (`headers`, `rows`, `rowCount`, `columnCount`, `caption`) with **no LLM** — pure parsing that understands `thead`/`tbody`, `colspan`, and caption. `pdf`/`mhtml` force a browser render; `tables` works on any HTML.

```bash
curl -s -X POST "$BASE/api/scrape" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://en.wikipedia.org/wiki/Comparison_of_web_browsers","options":{"formats":["tables","pdf","mhtml"]}}'
# -> { "formats": { "tables":[{"headers":[…],"rows":[[…]],"rowCount":42,"columnCount":6}], "pdf":"data:application/pdf;base64,…", "mhtml":"From: <Saved…" } }
```

**Raw JS execution — `executeJs`.** Run JavaScript in the page after load and get the return value back as `jsResult`. Forces a browser render and bypasses cache. Gated by `ENABLE_JS_EXECUTION` (set to `false` to disable in hardened deployments).

```bash
curl -s -X POST "$BASE/api/scrape" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","options":{"executeJs":"return document.querySelectorAll(\"a\").length"}}'
# -> { "jsResult": 1, ... }
```

**Change tracking — `changeTracking` format.** Add `changeTracking` to `formats` to diff a page's main-content markdown against the previous scrape of the same URL. Returns `changeStatus` (`new` \| `same` \| `changed`), the previous timestamp, and — when changed — a git-style `diff.gitDiff` plus structured `added`/`removed` line lists. Snapshots are stored in Redis (30-day TTL, `CHANGE_TRACKING_TTL`).

```bash
curl -s -X POST "$BASE/api/scrape" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","options":{"formats":["markdown","changeTracking"]}}'
# first call  -> { "formats": { "changeTracking": { "changeStatus":"new", "currentScrapeAt":"…" } } }
# later call  -> { "formats": { "changeTracking": { "changeStatus":"changed", "previousScrapeAt":"…",
#                    "diff": { "gitDiff":"--- previous\n+++ current\n@@ …", "added":["…"], "removed":["…"] } } } }
```

### 2. Structured extraction

**Deterministic CSS extraction (no LLM — free & fast).** Provide `extractionOptions.cssSchema` and get one record per `baseSelector` match. Field types: `text`, `attribute`, `html`, `number`, `list`, `nested`, `nested_list`.

```bash
curl -s -X POST "$BASE/api/scrape" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "url":"https://quotes.toscrape.com",
  "options":{"extractionOptions":{"cssSchema":{
    "baseSelector":"div.quote",
    "fields":[
      {"name":"text","selector":"span.text","type":"text"},
      {"name":"author","selector":"small.author","type":"text"},
      {"name":"tags","selector":"a.tag","type":"list"}
    ]}}}
}'
# -> { "structuredData": [ {"text":"…","author":"Albert Einstein","tags":["change","deep-thoughts",…]}, … ] }
```

**LLM extraction (schema-validated + chunked).** Provide a JSON schema; output is validated with ajv and long pages are automatically chunked (token-aware, with overlap) and merged. Requires `OPENAI_API_KEY`.

```bash
curl -s -X POST "$BASE/api/extract-schema" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "url":"https://example.com/product",
  "schema":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"string"}},"required":["name"]}
}'
```

### 3. Web search — `POST /api/search`

Search the web and optionally scrape each result. Providers: **serper** (keyed, reliable), **searxng** (self-hosted), **duckduckgo** (keyless, best-effort). The provider is auto-selected: `SERPER_API_KEY` → `SEARXNG_URL` → DuckDuckGo.

```bash
curl -s -X POST "$BASE/api/search" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"web scraping techniques","limit":5,"scrapeResults":false}'
```

```jsonc
{ "success": true, "query": "…", "count": 5,
  "results": [ {"position":1,"title":"…","url":"https://…","snippet":"…","markdown":"…(if scrapeResults)"} ] }
```

| Body field | Default | Description |
|---|---|---|
| `query` | — | Search query (required) |
| `limit` | 10 | Max results (≤50) |
| `provider` | auto | `serper` \| `searxng` \| `duckduckgo` |
| `scrapeResults` | false | Scrape each result to markdown |
| `scrapeOptions` | — | Options forwarded to the scraper when `scrapeResults` |

> ⚠️ Keyless DuckDuckGo is **best-effort** — it anti-bot-challenges datacenter IPs. Set `SERPER_API_KEY` (free tier at serper.dev) or `SEARXNG_URL` for reliable results.

### 4. Web crawling (multi-level, guided)

`POST /api/crawl` performs a **true multi-level** crawl (respecting `maxDepth`), stays on-domain, honors `robots.txt`, dedupes, and enforces a hard page budget.

```bash
curl -s -X POST "$BASE/api/crawl" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "url":"https://docs.example.com",
  "limit":500,
  "maxDepth":3,
  "useMapDiscovery":true,
  "scrapeOptions":{"extractorFormat":"markdown","preferHttpScraper":true}
}'
# -> { "success": true, "id": "…", "url": "http://localhost:3000/api/crawl/<id>", "outputDirectory":"…" }
```

Key options:

| Option | Default | Description |
|---|---|---|
| `limit` | 100 | Max pages (capped by `MAX_CRAWL_LIMIT`) |
| `maxDepth` | 5 | Crawl depth (capped by `MAX_CRAWL_DEPTH`) |
| `useMapDiscovery` | false | Seed from the sitemap (complete + fast) instead of link-by-link |
| `strategy` | bfs | `bfs` \| `best_first` |
| `keywords` | — | With `strategy:"best_first"`, crawl the most relevant URLs first |
| `includePaths` / `excludePaths` | — | Regex path filters (validated; bad regex rejected) |
| `allowSubdomains` | false | Follow subdomain links |
| `ignoreRobotsTxt` | false | Skip robots.txt |
| `webhook` | — | POST results when done (SSRF-guarded) |

**Check status** (from Redis — reliable, includes progress):

```bash
curl -s "$BASE/api/crawl/<id>" -H "X-API-Key: $API_KEY"
# -> { "status":"completed", "progress":{"total":500,"completed":498,"failed":2,"pending":0}, "jobs":[…], "exportedFiles":{…} }
```

**Cancel:**

```bash
curl -s -X DELETE "$BASE/api/crawl/<id>" -H "X-API-Key: $API_KEY"   # -> status becomes "cancelled"
```

### 5. Getting crawl results out

Three ways, use whichever fits:

**a) Live stream (SSE)** — pages pushed as they complete (an upstream project-style):

```bash
curl -N "$BASE/api/crawl/<id>/stream" -H "X-API-Key: $API_KEY"
# event: open
# event: page   -> data: {"url":"…","title":"…","markdown":"…","metadata":{…}}
# event: progress -> data: {"total":…,"completed":…,"failed":…,"pending":…}
# event: done   -> data: {"status":"completed",…}
```

**b) Download over HTTP** (no filesystem access needed):

```bash
curl "$BASE/api/crawl/<id>/download/zip"  -H "X-API-Key: $API_KEY" -o crawl.zip   # markdown files + manifest.json
curl "$BASE/api/crawl/<id>/download/json" -H "X-API-Key: $API_KEY" -o crawl.json  # consolidated array
```

**c) Files on disk** — every page is written to `CRAWL_OUTPUT_DIR` (`./crawl-output/<id>/` on the host via the Docker bind mount) in real time, plus a `_summary.md` and consolidated `.markdown`/`.json` on completion.

### 6. URL discovery incl. subdomains — `POST /api/map`

Discover a site's URLs from sitemaps/robots/crawling in seconds. With `includeSubdomains:true`, DeepScrape actively discovers sibling subdomains (e.g. `docs.`, `blog.`, `community.`) and merges each one's sitemap (round-robin so one huge subdomain can't crowd out the others).

```bash
curl -s -X POST "$BASE/api/map" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","maxUrls":5000,"includeSubdomains":true}'
# -> { "success": true, "data": { "links": ["https://docs.example.com/…", …], "total": 5000, "timeTaken": 10143, "discoveryMethods": {…} } }
```

| Body field | Default | Description |
|---|---|---|
| `maxUrls` | 5000 | Cap (≤30000) |
| `includeSubdomains` | true | Discover + merge sibling-subdomain sitemaps |
| `searchQuery` | — | Rank/filter discovered URLs by relevance |
| `includePatterns` / `excludePatterns` | — | Filter discovered URLs |
| `timeoutMs` | 60000 | Discovery timeout |
| `skipSitemaps` / `sitemapsOnly` | false | Control discovery methods |

### 7. Fast HTTP scraping — `preferHttpScraper`

For server-rendered sites (docs, blogs, wikis), skip the headless browser and fetch via HTTP — ~8× faster. Falls back to Playwright automatically if the page comes back empty. Great for large crawls of static sites.

```bash
curl -s -X POST "$BASE/api/scrape" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://docs.example.com/page","options":{"preferHttpScraper":true,"extractorFormat":"markdown"}}'
```

### 8. Security

- **SSRF protection** — every outbound fetch (scrape, crawl, sitemap, webhook, discovery) resolves DNS and blocks private/loopback/link-local/**cloud-metadata (`169.254.169.254`)**/encoded-IP targets, re-validating on every redirect hop. Set `ALLOW_PRIVATE_NETWORK_SCRAPE=true` only for trusted internal deployments.
- **Auth** — API key via the `X-API-Key` header only (never query string), constant-time compared, never logged. Supports comma-separated keys for rotation. In production the server refuses to start without a strong key.
- **Rate limiting** — per-key (falls back to IP): global + stricter limits on scrape/crawl/search. Returns `429` with `RateLimit-*` headers.
- **Daily quotas** — set `DAILY_QUOTA` (per key/day). Responses carry `X-Quota-Limit`/`X-Quota-Remaining`; over-quota returns `429`. Per-key overrides via `DAILY_QUOTA_OVERRIDES=keyA:5000,keyB:100000`.
- **Crawl caps** — `limit`/`maxDepth`/concurrency are clamped; invalid include/exclude regexes are rejected (ReDoS-safe).

### 9. Observability & health

```bash
curl "$BASE/health"        # liveness -> {"status":"UP"}
curl "$BASE/health/ready"  # readiness (checks Redis) -> {"status":"READY","redis":"up"} or 503
curl "$BASE/metrics"       # Prometheus text: http_requests_total, http_request_duration_seconds, deepscrape_*
```

### 10. Horizontal scaling — `ROLE`

Run the web tier and worker tier as separate processes/replicas:

```bash
ROLE=web    npm start   # serve the API + enqueue jobs (no worker)
ROLE=worker npm start   # process crawl/scrape jobs only (scale these independently)
ROLE=all    npm start   # both (default)
```

Safe to run multiple worker replicas — the queue is no longer wiped on boot and job ids are deterministic.

### 11. MCP server (for AI agents)

A Model Context Protocol server lets Claude/Cursor/etc. call DeepScrape as tools. It lives in [`mcp/`](mcp/) as its own package and exposes: `deepscrape_scrape`, `deepscrape_map`, `deepscrape_crawl`, `deepscrape_crawl_status`, `deepscrape_search`, `deepscrape_agent` + `deepscrape_agent_status` (autonomous navigation), and `deepscrape_session_create` + `deepscrape_session_action` + `deepscrape_session_close` (interactive browser sessions).

```bash
cd mcp && npm install && npm run build
```

Configure it in your MCP client (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "deepscrape": {
      "command": "node",
      "args": ["/absolute/path/to/deepscraper/mcp/dist/server.js"],
      "env": { "DEEPSCRAPE_API_URL": "http://localhost:3000", "DEEPSCRAPE_API_KEY": "your-secret-key" }
    }
  }
}
```

See [`mcp/README.md`](mcp/README.md) for details.

### 12. Node SDK

A typed client lives in [`sdk/`](sdk/). Zero dependencies (uses global `fetch`).

```ts
import { DeepScrapeClient } from './sdk/src';

const client = new DeepScrapeClient({ baseUrl: 'http://localhost:3000', apiKey: process.env.API_KEY! });

// Scrape
const page = await client.scrape('https://example.com', { extractorFormat: 'markdown' });

// Search
const hits = await client.search('web scraping', { limit: 5 });

// Crawl + wait for completion
const { id } = await client.startCrawl('https://docs.example.com', { limit: 200, useMapDiscovery: true });
const final = await client.waitForCrawl(id);

// Or stream pages as they complete
for await (const evt of client.streamCrawl(id)) {
  if (evt.event === 'page') console.log(evt.data.url);
}
```

See [`sdk/README.md`](sdk/README.md) for the full API.

### 13. New configuration (env)

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | — | Full Redis URL incl. `rediss://` TLS + auth (for managed Redis); overrides host/port |
| `REDIS_PASSWORD` / `REDIS_TLS` | — | Auth/TLS when using host/port |
| `ALLOW_PRIVATE_NETWORK_SCRAPE` | false | Disable SSRF private-IP blocking (trusted internal only) |
| `MAX_CRAWL_LIMIT` / `MAX_CRAWL_DEPTH` | 1000 / 10 | Hard crawl caps |
| `MAX_BROWSERS` / `MAX_CONTEXTS_PER_BROWSER` | 3 / 8 | Browser pool sizing (memory tuning) |
| `CRAWLER_CONCURRENCY` | 5 | Worker concurrency |
| `RATE_LIMIT_GLOBAL` / `_EXPENSIVE` / `_CRAWL` | 120 / 20 / 10 | Per-window request limits |
| `DAILY_QUOTA` / `DAILY_QUOTA_OVERRIDES` | 0 (off) | Per-key daily quota |
| `SERPER_API_KEY` / `SEARXNG_URL` | — | Reliable `/api/search` providers |
| `ROLE` | all | `web` \| `worker` \| `all` |
| `MAX_RESPONSE_BYTES` | 10485760 | Max fetched page size |
| `LOG_TO_FILE` / `LOG_MAX_SIZE` / `LOG_MAX_FILES` | true / 20m / 14d | Log rotation |
| `ENABLE_JS_EXECUTION` | true | Allow the `executeJs` scrape option + session `evaluate` (set `false` to disable) |
| `CHANGE_TRACKING_TTL` | 2592000 | Change-tracking snapshot TTL in seconds (30 days) |
| `TASK_CONCURRENCY` | 3 | Async task-queue worker concurrency (extract/llmstxt/scrape/agent) |
| `MAX_DOC_BYTES` | 26214400 | Max document size for `/api/parse` (25 MB) |
| `MAX_BROWSER_SESSIONS` | 10 | Max concurrent interactive sessions |
| `SESSION_IDLE_TTL_MS` / `SESSION_MAX_LIFETIME_MS` | 300000 / 1800000 | Session idle reap + absolute lifetime |
| `AGENT_MAX_STEPS_CAP` | 20 | Hard cap on agent navigation steps |
| `PROXY_LIST` | — | Comma-separated egress proxies for the browser path (empty = off) |
| `PROXY_USERNAME` / `PROXY_PASSWORD` | — | Shared proxy creds (or embed per-proxy as `user:pass@host`) |
| `PROXY_MAX_FAILURES` / `PROXY_COOLDOWN_MS` | 3 / 60000 | Proxy health: failures before cooldown, cooldown length |
| `SELF_HEAL_SCHEMA_TTL` | 604800 | Derived CSS-schema cache TTL for `/api/extract-auto` (7 days) |
| `SELF_HEAL_HEALTHY_RATIO` | 0.5 | Min fraction of records with populated required fields before "breakage" |
| `SESSION_STEALTH` | true | Fingerprint hygiene for sessions/agent (set `false` for a plain UA) |
| `SITE_VERIFY_INTERVAL_MS` | 86400000 | SiteSpec verifier cadence (24h; `<=0` disables) |

See [`.env.example`](.env.example) for the complete list.

---

### 14. Async jobs, document parsing & introspection

Long-running work runs on a **BullMQ-backed async task queue** (persistent, retried, and scalable with `ROLE=worker`), so requests return a job id immediately and you poll for the result. Job status survives worker restarts.

**Multi-URL LLM extract — `POST /api/extract`.** Extract structured data across many pages against one schema. Pass explicit `urls`, or a single `url` to auto-discover pages from the site (map). Returns a job id; poll `GET /api/extract/:id`. Requires an LLM key (`OPENAI_API_KEY`) — without one, each source reports a concrete reason rather than failing silently.

```bash
curl -s -X POST "$BASE/api/extract" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "urls":["https://example.com/a","https://example.com/b"],
  "prompt":"Extract the product name and price",
  "schema":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"string"}}}
}'
# -> { "id":"<job>", "status":"pending", "url":"…/api/extract/<job>" }
curl -s "$BASE/api/extract/<job>" -H "X-API-Key: $API_KEY"
# -> { "status":"completed", "result":{ "data":[{…},{…}], "sources":[{"url":"…","success":true}] } }
```

**Async single scrape — `POST /api/scrape/async`.** The full `/api/scrape` (all options/formats) as a background job; poll `GET /api/scrape/job/:id`.

**`llms.txt` generation — `POST /api/llmstxt`.** Discover a site's pages and produce an [`llms.txt`](https://llmstxt.org/) index (title + description per page); set `includeFullText:true` to also get `llms-full.txt` with each page's markdown. Poll `GET /api/llmstxt/:id`.

```bash
curl -s -X POST "$BASE/api/llmstxt" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://docs.example.com","maxUrls":100,"includeFullText":false}'
# -> { "id":"<job>", ... }   then GET /api/llmstxt/<job>
# result: { "host":"docs.example.com", "pageCount":87, "llmstxt":"# docs.example.com\n\n> …\n\n## Pages\n- [Title](url): desc\n…" }
```

**Document parsing — `POST /api/parse`.** Convert a **PDF / DOCX / HTML** document to markdown. Pass base64 `content` or a `url` to fetch (SSRF-guarded). The type is sniffed from magic bytes, so a mislabeled file still parses. Synchronous.

```bash
curl -s -X POST "$BASE/api/parse" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/whitepaper.pdf"}'
# -> { "success":true, "markdown":"# Title\n\n…", "detectedType":"pdf", "metadata":{"pages":12} }
```

**Usage / credits — `GET /api/usage`.** The calling key's usage against its daily quota.

```bash
curl -s "$BASE/api/usage" -H "X-API-Key: $API_KEY"
# -> { "usage": { "requestsToday": 42, "dailyLimit": 1000, "remaining": 958, "unlimited": false } }
```

**Error introspection & active crawls.** Every crawl/batch failure is recorded with its URL and reason:

| Endpoint | Returns |
|---|---|
| `GET /api/crawl/active` | In-flight crawls with live progress (`total`/`success`/`failed`/`done`) |
| `GET /api/crawl/:id/errors` | Failed pages for a crawl — `{ url, error, at }` per failure |
| `GET /api/batch/scrape/:id/errors` | Failed URLs for a batch — `{ id, url, error }` per failure |

```bash
curl -s "$BASE/api/crawl/active" -H "X-API-Key: $API_KEY"
# -> { "active":[{"id":"…","url":"…","createdAt":…,"progress":{"total":50,"success":48,"failed":2,"done":50}}] }
curl -s "$BASE/api/crawl/<id>/errors" -H "X-API-Key: $API_KEY"
# -> { "success":true, "count":2, "errors":[{"url":"…","error":"…","at":"…"}] }
```

> Reliability note: a page that fails to fetch (DNS/HTTP/timeout) is now correctly counted as a **failure** — recorded in `/errors` and reflected in the crawl/batch status (`completed_with_errors`) — instead of being miscounted as a successful scrape.

### 15. Interactive sessions, autonomous agent & proxy rotation

**Persistent browser sessions — `/api/sessions`.** Keep a real browser context alive across many calls so you can drive it step by step (cookies/auth/JS state persist between actions). Ideal for authenticated flows and multi-step interactions.

```bash
# Create a session (optionally navigate on creation)
curl -s -X POST "$BASE/api/sessions" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"initialUrl":"https://example.com"}'
# -> { "session": { "id":"<sid>", "currentUrl":"https://example.com/", "currentTitle":"Example Domain", ... } }

# Drive it: one action per call
curl -s -X POST "$BASE/api/sessions/<sid>/action" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"type":"navigate","url":"https://example.com/login"}'
curl -s -X POST "$BASE/api/sessions/<sid>/action" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"type":"type","selector":"#user","text":"alice"}'
curl -s -X POST "$BASE/api/sessions/<sid>/action" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"type":"scrape","formats":["markdown","links"]}'
# Then GET /api/sessions/<sid> (status), GET /api/sessions (list), DELETE /api/sessions/<sid> (close)
```

Actions: `navigate`, `click`, `type`, `fill`, `select`, `scroll`, `waitForSelector`, `wait`, `screenshot`, `scrape`, `evaluate` (gated by `ENABLE_JS_EXECUTION`), `back`, `forward`, `reload`, `content`. Every `navigate` is SSRF-guarded. Sessions are capped (`MAX_BROWSER_SESSIONS`), idle-reaped (`SESSION_IDLE_TTL_MS`), and force-closed at `SESSION_MAX_LIFETIME_MS`.

> Scope: sessions are in-memory and pinned to one process — with `ROLE=web|worker` (or multiple replicas) front them with sticky routing.

**Autonomous agent — `/api/agent`.** Give a natural-language goal and a start URL; the agent drives a session in a bounded observe → decide → act loop (an LLM picks navigate/click/type/finish each step), then returns a structured (schema) or textual answer. Async — poll `GET /api/agent/:id`. Requires an LLM key (`OPENAI_API_KEY`); without one the job fails fast with a clear reason.

```bash
curl -s -X POST "$BASE/api/agent" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "url":"https://docs.example.com",
  "prompt":"Find the current stable version number and its release date",
  "schema":{"type":"object","properties":{"version":{"type":"string"},"released":{"type":"string"}}},
  "maxSteps":6
}'
# -> { "id":"<job>", ... }   then GET /api/agent/<job>
# result: { "completed":true, "finalUrl":"…", "steps":[{step,thought,action,url},…], "data":{"version":"…","released":"…"} }
```

Hard bounds: step budget (`maxSteps`, capped by `AGENT_MAX_STEPS_CAP`), per-action timeouts, SSRF-guarded navigation, strict JSON action contract, guaranteed session teardown.

**Proxy rotation — browser path.** Configure an egress-proxy pool via `PROXY_LIST`; the browser pool, sessions, and agent rotate across proxies round-robin with per-proxy health tracking (a proxy that fails repeatedly is put on cooldown) and escalation (session creation retries the next proxy on a failed initial navigation). Check status at `GET /api/proxies`.

```bash
# PROXY_LIST="http://user:pass@proxy1:8000,http://proxy2:8000" in the environment
curl -s "$BASE/api/proxies" -H "X-API-Key: $API_KEY"
# -> { "enabled":true, "total":2, "healthy":2, "proxies":[{"server":"http://proxy1:8000","healthy":true,"failures":0}, …] }
```

> Proxies apply to the **browser** path only, by design. The HTTP/axios path pins each connection to a pre-validated public IP (per-hop SSRF protection) that an HTTP proxy would bypass — and browser-rendered scrapes are where proxies matter most. **There is no CAPTCHA-solving / bot-detection-bypass component** — this is proxy rotation infrastructure, nothing more.

### 16. Self-healing extraction, confidence signals & fingerprint hygiene

**Self-healing extraction — `POST /api/extract-auto`.** The pattern that fixes the "my scrapers break every week" problem: an LLM derives robust CSS selectors **once**, they're cached, and every subsequent call runs **deterministic** (free, fast) extraction. When the site changes and the selectors stop yielding data (breakage detected), it automatically re-derives and re-caches. You can bootstrap with your own `cssSchema` to skip the first LLM call.

```bash
curl -s -X POST "$BASE/api/extract-auto" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "url":"https://quotes.toscrape.com",
  "fields":[{"name":"text","required":true},{"name":"author","required":true}]
}'
# -> { "success":true, "data":[{"text":"…","author":"Albert Einstein"}, …],
#      "meta": { "source":"derived|cache|healed", "healed":false, "healthy":true,
#                "recordCount":10, "schema":{…derived CSS selectors, reusable…} } }
```

`meta.source` tells you what happened (`derived` first time, `cache` on reuse, `healed` after a breakage), and `meta.schema` returns the selectors so you can inspect or reuse them. Deriving/re-deriving needs an LLM key; the deterministic + cache + breakage-detect path works without one.

**Extraction confidence signals.** LLM extraction (`/api/extract`, `extractionOptions`) now returns a deterministic, grounding-based confidence report so hallucination and omission stop being silent. Each field is checked against the source text; values that aren't substantiated are flagged.

```jsonc
"confidence": {
  "overall": 0.9,
  "fields": { "name": {"present":true,"grounded":true,"confidence":0.9},
              "price": {"present":true,"grounded":false,"confidence":0.3} },
  "suspect": ["price"],   // present but NOT found in source → possible hallucination
  "missing": []           // absent/empty → omission
}
```

**Anti-bot fingerprint hygiene.** Browser scrapes, sessions, and the agent use one internally-consistent fingerprint per context (UA + platform + locale + timezone + WebGL all agree) and patch the common automation leaks (`navigator.webdriver`, missing `window.chrome`, empty plugins, headless WebGL vendor). This stops *legitimate* scrapes from being falsely flagged as bots.

> Scope, stated honestly: this is fingerprint **hygiene**, not warfare. It does **not** solve CAPTCHAs or defeat Cloudflare Turnstile/DataDome, and it is **not** a residential-proxy "unlocker" — hard targets need a purpose-built anti-detect browser. `robots.txt` is still honored; set `SESSION_STEALTH=false` (or `stealthMode:false`) for a plain, honest fingerprint.

### 17. Hidden-API discovery, markdown reader & cost estimate

**Hidden-API discovery — `POST /api/discover-apis`.** JS-heavy sites almost always pull their data from a JSON/GraphQL endpoint under the hood. This loads the page in a real browser, records the XHR/fetch calls, and returns the JSON-ish endpoints so you can query them directly — far cheaper and more stable than scraping rendered HTML.

```bash
curl -s -X POST "$BASE/api/discover-apis" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://quotes.toscrape.com/scroll"}'
# -> { "count":1, "apis":[{"url":"https://quotes.toscrape.com/api/quotes?page=1","method":"GET","status":200,"contentType":"application/json","isJson":true}] }
```

**Markdown reader — `GET /api/reader?url=...`.** A one-shot "URL → clean markdown" reader that honors the emerging `Accept: text/markdown` agent convention: send that header and you get the raw markdown body; otherwise you get JSON.

```bash
curl -s "$BASE/api/reader?url=https://example.com" -H "X-API-Key: $API_KEY" -H "Accept: text/markdown"   # -> raw markdown
curl -s "$BASE/api/reader?url=https://example.com" -H "X-API-Key: $API_KEY"                               # -> { markdown, title, ... }
```

**Pre-run cost estimate — `POST /api/crawl/estimate`.** Know the size and cost shape *before* you run — no bill shock. Returns max pages (capped by `MAX_CRAWL_LIMIT`), render mode, estimated LLM calls, and an honest flat-cost note.

```bash
curl -s -X POST "$BASE/api/crawl/estimate" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"limit":250,"scrapeOptions":{"extractionOptions":{"schema":{}}}}'
# -> { "estimate": { "maxPages":250, "renderMode":"http", "estimatedLlmCalls":250,
#      "pricing":"self-hosted: flat infrastructure cost — no per-page credits, no bill shock.", "note":"…" } }
```

### 18. Site → MCP endpoint generator (`/api/sites`)

Turn any site into a **saved, named, self-healing extraction endpoint** that your agents call over MCP — the self-hosted answer to "turn a website into an API for agents." A **SiteSpec** stores the fields you want + the derived CSS selectors; running it is deterministic (free), and it **re-derives selectors automatically when the site breaks**. Because it runs on *your* infra, it works on your authenticated/internal sites too.

```bash
# Create a spec (LLM derives selectors from the fields; or pass cssSchema to bootstrap)
curl -s -X POST "$BASE/api/sites" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "name":"acme_products",
  "description":"Product name + price from an Acme category page",
  "url":"https://acme.com/category/{category}",
  "params":[{"name":"category","required":true}],
  "fields":[{"name":"title","required":true},{"name":"price","type":"number","required":true}],
  "verify":true
}'
# -> { "spec": { "name":"acme_products", "health":"healthy", ... }, "sample":[ … ] }

# Run it (templated params allowed); self-heals on drift
curl -s -X POST "$BASE/api/sites/by-name/acme_products/run" -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" -d '{"params":{"category":"shoes"}}'
# -> { "success":true, "data":[ … ], "health":"healthy", "source":"cache", "recordCount":24, "fieldFillRatio":1 }
```

Endpoints: `POST /api/sites` (create), `GET /api/sites` (list), `GET /api/sites/:id` (full spec incl. selectors), `POST /api/sites/:id/run` and `POST /api/sites/by-name/:name/run`, `POST /api/sites/:id/verify`, `DELETE /api/sites/:id`. An opt-in **scheduled verifier** (`verify:true`, `SITE_VERIFY_INTERVAL_MS`) re-runs specs and self-heals on drift.

**Authenticated / internal sites (the differentiator).** Bind a spec to a persistent [session](#15-interactive-sessions-autonomous-agent--proxy-rotation) with `sessionId`, and the spec extracts *within that session's authenticated context* — so it works on gated dashboards and internal tools that no hosted service can reach. **DeepScrape never stores credentials**: you authenticate the session yourself (the session actions you issue), and the spec holds only the session reference.

```bash
# 1) create a session, 2) log in via session actions (your creds, your API calls):
#    POST /api/sessions {initialUrl:"https://intranet/login"}
#    POST /api/sessions/<sid>/action {type:"type", selector:"#user", text:"…"}   (+ password, click)
# 3) bind a spec to the authenticated session:
curl -s -X POST "$BASE/api/sites" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "name":"internal_dashboard", "url":"https://intranet/reports",
  "fields":[{"name":"metric","required":true}], "sessionId":"<sid>"
}'
# runs (and the site_internal_dashboard MCP tool) now read the logged-in page.
```

> Honest limitation: sessions are in-memory and idle-reaped (`SESSION_IDLE_TTL_MS`, default 5 min; `SESSION_MAX_LIFETIME_MS`, 30 min). For long-lived authenticated specs, raise those TTLs; when a bound session expires, runs return `health:"degraded"` with a clear "re-bind" message rather than silently scraping the logged-out page.

**In MCP, every spec becomes its own tool.** The MCP server exposes `deepscrape_sites_list` + `deepscrape_site_run`, **plus one dynamic `site_<name>` tool per saved spec** — so an agent discovers `site_acme_products` (with a typed `category` input), not a generic verb. Restart the MCP server to pick up newly-created specs.

> Positioning: this is the **self-hosted** counterpart to hosted "website→agent-API" services — no per-call fees, your data stays yours, and it works on internal/authenticated sites you'd never hand to a third party. It is **read-first**; reliable arbitrary transactions are deliberately out of scope.

---

## 🚀 **Quick Recommendations**

### **For Maximum Performance:**
```bash
# Use /api/crawl with useMapDiscovery for best results
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.example.com",
    "useMapDiscovery": true,
    "maxUrls": 1000,
    "includePatterns": ["/api/", "/docs/"],
    "scrapeOptions": { "extractorFormat": "markdown" }
  }'
```

### **For Bot-Protected Sites:**
```bash
# Use browser-based scraping with stealth mode
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://protected-site.com",
    "useMapDiscovery": true,
    "maxUrls": 100,
    "skipSitemaps": true,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true
    }
  }'
```

### **For Rate-Limited Sites:**
```bash
# Conservative crawling with delays
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://api-limited-site.com",
    "useMapDiscovery": true,
    "maxUrls": 500,
    "crawlOptions": {
      "maxConcurrentCrawlers": 1,
      "crawlTimeoutPerPage": 8000
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "minDelay": 2000,
      "maxRetries": 3
    }
  }'
```

## API Usage

### Basic Scraping

```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://example.com",
    "options": { "extractorFormat": "markdown" }
  }' | jq -r '.content' > content.md
```

### Downloading Markdown Output

**Single page (save Markdown):**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://example.com",
    "options": { "extractorFormat": "markdown" }
  }' | jq -r '.content' > page.md
```

**Batch ZIP (Markdown files inside):**
```bash
curl -L -o batch.zip \
  "https://deepscrapper.ai/api/batch/scrape/<BATCH_ID>/download/zip?format=markdown" \
  -H "X-API-Key: your-secret-key"
```

**Batch single result (Markdown):**
```bash
curl -L -o item.md \
  "https://deepscrapper.ai/api/batch/scrape/<BATCH_ID>/download/<JOB_ID>?format=markdown" \
  -H "X-API-Key: your-secret-key"
```

### Complete `/api/scrape` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`url`** (string): The URL to scrape

**Optional Parameters:**
- **`options`** (object): Scraper options configuration (see below)

#### **Scraper Options (`options` object)**

**Output Format Options:**
- **`extractorFormat`** (enum, default: "markdown"): Output format for scraped content
  - `"html"`: Raw HTML content
  - `"markdown"`: Clean markdown format (recommended)
  - `"text"`: Plain text only

**Browser Configuration:**
- **`useBrowser`** (boolean, default: false): Use Playwright browser for JavaScript-heavy sites
- **`javascript`** (boolean, default: true): Enable JavaScript execution
- **`fullPage`** (boolean, default: false): Capture full page screenshot/content
- **`stealthMode`** (boolean, default: false): Enable stealth mode to avoid bot detection
- **`blockAds`** (boolean, default: false): Block advertisements and tracking scripts
- **`blockResources`** (boolean, default: false): Block images, fonts, media for faster loading

**Wait & Loading Options:**
- **`waitForSelector`** (string): CSS selector to wait for before scraping
- **`waitForTimeout`** (number, default: 0): Additional wait time in milliseconds after page load
- **`timeout`** (number, default: 30000): Total request timeout in milliseconds
- **`maxScrolls`** (number, default: 0): Maximum number of scrolls for infinite scroll pages

**Authentication & Headers:**
- **`userAgent`** (string): Custom user agent string
- **`cookies`** (object): Cookie key-value pairs (e.g., `{"sessionId": "abc123"}`)
- **`headers`** (object): Custom HTTP headers (e.g., `{"Authorization": "Bearer token"}`)

**Proxy Configuration:**
- **`proxy`** (string): Proxy server URL (e.g., "http://proxy.example.com:8080")
- **`proxyUsername`** (string): Proxy authentication username
- **`proxyPassword`** (string): Proxy authentication password
- **`proxyRotation`** (boolean, default: false): Enable proxy rotation
- **`proxyList`** (string[]): List of proxy URLs for rotation

**Rate Limiting:**
- **`minDelay`** (number, default: 0): Minimum delay between requests in milliseconds
- **`maxDelay`** (number, default: 0): Maximum delay for exponential backoff
- **`maxRetries`** (number, default: 3): Maximum retry attempts for failed requests
- **`backoffFactor`** (number, default: 2): Exponential backoff multiplier
- **`rotateUserAgent`** (boolean, default: false): Rotate user agents between requests

**Browser Actions:**
- **`actions`** (array): Array of browser actions to perform before scraping (see Browser Actions guide for details)

**Cache Options:**
- **`skipCache`** (boolean, default: false): Skip cache for this request
- **`cacheTtl`** (number): Custom cache TTL in seconds
- **`skipTlsVerification`** (boolean, default: false): Skip TLS certificate verification

#### **Sample API Calls**

**JavaScript-Heavy Site with Actions:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://spa-website.com",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "javascript": true,
      "waitForSelector": ".content-loaded",
      "actions": [
        {"type": "click", "selector": ".cookie-accept", "optional": true},
        {"type": "wait", "timeout": 3000},
        {"type": "scroll", "position": 1000}
      ]
    }
  }'
```

**Protected Site with Proxy and Authentication:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://protected-site.com/data",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true,
      "proxy": "http://residential-proxy.com:8080",
      "proxyUsername": "user123",
      "proxyPassword": "pass456",
      "cookies": {
        "auth_token": "abc123xyz"
      },
      "headers": {
        "Authorization": "Bearer token123"
      }
    }
  }'
```

### URL Discovery (High-Performance)

Discover thousands of URLs from a website in seconds using our endpoint:

```bash
curl -X POST https://deepscrapper.ai/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.github.com",
    "maxUrls": 1000,
    "includeSubdomains": true
  }'
```

**Performance**: Discovers 5,000+ URLs in 2-3 seconds vs. traditional crawling (100 URLs in 2-5 minutes).

### Complete `/api/map` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`url`** (string): The starting URL for discovery

**Discovery Control Options:**
- **`maxUrls`** (integer, default: 5000, max: 30000): Maximum number of URLs to discover
- **`includeSubdomains`** (boolean, default: true): Include subdomains in discovery
- **`skipSitemaps`** (boolean, default: false): Skip sitemap-based discovery
- **`sitemapsOnly`** (boolean, default: false): Use only sitemap-based discovery
- **`useUrlIndex`** (boolean, default: true): Use pre-built URL index (future feature)
- **`timeoutMs`** (integer, default: 30000, max: 300000): Discovery timeout in milliseconds

**Search & Filtering Options:**
- **`searchQuery`** (string): Optional search query for targeted discovery
- **`includePatterns`** (string[]): Include only URLs containing these path segments (e.g., `["docs", "api", "guides"]`)
- **`excludePatterns`** (string[]): Exclude URLs containing these patterns (e.g., `["admin", "login", "private"]`)

**Rate Limiting Options** (`rateLimitingOptions` object):**
- **`minDelay`** (number, default: 500): Minimum delay between requests (ms)
- **`maxConcurrency`** (number, default: 2): Maximum concurrent requests
- **`sitemapDelay`** (number, default: 300): Delay between sitemap requests (ms)
- **`batchSize`** (number, default: 3): Batch size for common path testing
- **`browserTimeout`** (number, default: 10000): Browser discovery timeout (ms)
- **`enableRetry`** (boolean, default: true): Enable exponential backoff retry
- **`maxRetries`** (number, default: 3): Maximum retry attempts

**Advanced Crawl Options** (`crawlOptions` object):**
- **`maxCrawlDepth`** (number, default: 3, max: 5): Maximum crawling depth
- **`maxConcurrentCrawlers`** (number, default: 8, max: 20): Maximum concurrent crawlers
- **`crawlTimeoutPerPage`** (number, default: 3000, max: 10000): Timeout per page in milliseconds
- **`maxLinksPerPage`** (number, default: 100, max: 500): Maximum links to extract per page
- **`enableDeepCrawling`** (boolean, default: true): Enable multi-level crawling
- **`browserPoolSize`** (number, default: 5, max: 15): Browser pool size for crawling

#### **Sample API Calls**

**Basic URL Discovery:**
```bash
curl -X POST https://deepscrapper.ai/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.github.com",
    "maxUrls": 1000,
    "includeSubdomains": true
  }'
```

**Filtered Discovery with Patterns:**
```bash
curl -X POST https://deepscrapper.ai/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.oracle.com/en-us/iaas/Content/home.htm",
    "maxUrls": 5000,
    "includeSubdomains": true,
    "includePatterns": ["/en-us/iaas/"],
    "excludePatterns": ["/admin/", "/login/"],
    "timeoutMs": 120000
  }'
```

**High-Performance Discovery with Enhanced Crawling:**
```bash
curl -X POST https://deepscrapper.ai/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://cloud.google.com/docs",
    "maxUrls": 5000,
    "includeSubdomains": true,
    "timeoutMs": 120000,
    "crawlOptions": {
      "maxCrawlDepth": 4,
      "maxConcurrentCrawlers": 15,
      "crawlTimeoutPerPage": 7000,
      "maxLinksPerPage": 300,
      "enableDeepCrawling": true,
      "browserPoolSize": 15
    },
    "skipSitemaps": false,
    "sitemapsOnly": false
  }'
```

**Conservative Discovery (GitHub-safe):**
```bash
curl -X POST https://deepscrapper.ai/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.github.com",
    "maxUrls": 1000,
    "includeSubdomains": true,
    "rateLimitingOptions": {
      "minDelay": 1000,
      "maxConcurrency": 1,
      "sitemapDelay": 500,
      "batchSize": 1,
      "browserTimeout": 20000,
      "enableRetry": true,
      "maxRetries": 2
    }
  }'
```

### Advanced Discovery with Search
```bash
curl -X POST https://deepscrapper.ai/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.stripe.com",
    "searchQuery": "api payment webhook",
    "includePatterns": ["api", "docs"],
    "maxUrls": 500
  }'
```

**Discovery Methods** (5 parallel methods):
- **Sitemap Discovery**: XML sitemaps, robots.txt references
- **Search Engine Discovery**: Site-specific search queries  
- **Browser Crawling**: JavaScript-rendered content
- **Common Path Discovery**: `/api`, `/docs`, `/swagger` patterns
- **Robots.txt Analysis**: Extract sitemap references

**Response Format**:
```json
{
  "success": true,
  "data": {
    "links": ["https://docs.github.com/api", "..."],
    "total": 847,
    "discoveryMethods": {
      "sitemap": 400,
      "search": 200,
      "crawling": 147,
      "commonPaths": 80,
      "robotsSitemaps": 20
    },
    "timeTaken": 2340,
    "fromCache": false
  }
}
```

### Schema-Based Extraction

Extract structured data using JSON Schema:

```bash
curl -X POST https://deepscrapper.ai/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://news.example.com/article",
    "schema": {
      "type": "object",
      "properties": {
        "title": { 
          "type": "string", 
          "description": "Article headline" 
        },
        "author": { 
          "type": "string", 
          "description": "Author name" 
        },
        "publishDate": { 
          "type": "string", 
          "description": "Publication date" 
        }
      },
      "required": ["title"]
    }
  }' | jq -r '.extractedData' > schemadata.md
```

### Summarize URL Content

Scrapes a URL and uses an LLM (GPT-4o) to generate a concise summary of its content.

```bash
curl -X POST https://deepscrapper.ai/api/summarize \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-key" \
  -d '{
    "url": "https://en.wikipedia.org/wiki/Large_language_model",
    "maxLength": 300,
    "options": {
      "temperature": 0.3,
      "waitForSelector": "body",
      "extractorFormat": "markdown"
    }
  }' | jq -r '.summary' > summary-output.md
  ```

### Complete `/api/summarize` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`url`** (string): The URL to summarize

**Optional Parameters:**
- **`maxLength`** (number, default: 300): Maximum length of summary in characters
- **`options`** (object): Scraper options (same as `/api/scrape`)
- **`temperature`** (number, default: 0.3): LLM temperature for summarization
- **`summaryType`** (enum, default: "concise"): Type of summary
  - `"concise"`: Brief overview
  - `"detailed"`: Comprehensive summary
  - `"bullets"`: Bullet point format
  - `"technical"`: Technical focus
- **`language`** (string, default: "en"): Output language code
- **`focus`** (string): Specific aspect to focus on in summary

#### **Sample API Calls**

**Technical Summary with Focus:**
```bash
curl -X POST https://deepscrapper.ai/api/summarize \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://arxiv.org/abs/2301.00234",
    "maxLength": 1000,
    "summaryType": "technical",
    "focus": "methodology and results",
    "temperature": 0.2,
    "options": {
      "extractorFormat": "markdown",
      "waitForSelector": ".ltx-article"
    }
  }'
```

**Bullet Point Summary:**
```bash
curl -X POST https://deepscrapper.ai/api/summarize \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://blog.example.com/long-article",
    "summaryType": "bullets",
    "maxLength": 800,
    "options": {
      "useBrowser": true,
      "javascript": true
    }
  }'
```

**Response Format:**
```json
{
  "success": true,
  "url": "https://example.com",
  "summary": "This article discusses artificial intelligence...",
  "summaryType": "concise",
  "wordCount": 85,
  "characterCount": 487,
  "loadTime": 3456,
  "fromCache": false
}
```

### Technical Documentation Analysis

Extract key information from technical documentation:

```bash

curl -X POST https://deepscrapper.ai/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-key" \
  -d '{
    "url": "https://docs.github.com/en/rest/overview/permissions-required-for-github-apps",
    "schema": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "overview": {"type": "string"},
        "permissionCategories": {"type": "array", "items": {"type": "string"}},
        "apiEndpoints": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "endpoint": {"type": "string"},
              "requiredPermissions": {"type": "array", "items": {"type": "string"}}
            }
          }
        }
      },
      "required": ["title", "overview"]
    },
    "options": {
      "extractorFormat": "markdown"
    }
  }' | jq -r '.extractedData' > output.md
```  

### Comparative Analysis from Academic Papers

Extract and compare methodologies from research papers:

```bash
curl -X POST https://deepscrapper.ai/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-key" \
  -d '{
    "url": "https://arxiv.org/abs/2005.14165",
    "schema": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "authors": {"type": "array", "items": {"type": "string"}},
        "abstract": {"type": "string"},
        "methodology": {"type": "string"},
        "results": {"type": "string"},
        "keyContributions": {"type": "array", "items": {"type": "string"}},
        "citations": {"type": "number"}
      }
    },
    "options": {
      "extractorFormat": "markdown"
    }
  }' | jq -r '.extractedData' > output.md
```

### Complex Data Analysis from Medium Articles

Extract complex data structure from any medium articles

```bash
   curl -X POST https://deepscrapper.ai/api/extract-schema \
     -H "Content-Type: application/json" \
     -H "X-API-Key: test-key" \
     -d '{
       "url": "https://johnchildseddy.medium.com/typescript-llms-lessons-learned-from-9-months-in-production-4910485e3272",
       "schema": {
         "type": "object",
         "properties": {
           "title": {"type": "string"},
           "author": {"type": "string"},
           "keyInsights": {"type": "array", "items": {"type": "string"}},
           "technicalChallenges": {"type": "array", "items": {"type": "string"}},
           "businessImpact": {"type": "string"}
         }
       },
	"options": {
      "extractorFormat": "markdown"
    }
  }' | jq -r '.extractedData' > output.md
```

### Complete `/api/extract-schema` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`url`** (string): The URL to extract data from
- **`schema`** (object): JSON Schema defining the structure to extract

**Optional Parameters:**
- **`options`** (object): Scraper options (same as `/api/scrape`)
- **`temperature`** (number, default: 0.2): LLM temperature for extraction (0.0-1.0)
- **`maxTokens`** (number, default: 4096): Maximum tokens for LLM response
- **`model`** (string, default: "gpt-4o"): OpenAI model to use

#### **Schema Definition**

The schema follows JSON Schema specification with additional extraction hints:

```json
{
  "type": "object",
  "properties": {
    "fieldName": {
      "type": "string|number|boolean|array|object",
      "description": "Extraction hint for the LLM",
      "items": {},  // For arrays
      "properties": {}  // For nested objects
    }
  },
  "required": ["fieldName"]
}
```

#### **Sample API Calls**

**Extract E-commerce Product Data:**
```bash
curl -X POST https://deepscrapper.ai/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://shop.example.com/product/123",
    "schema": {
      "type": "object",
      "properties": {
        "productName": {
          "type": "string",
          "description": "Product title"
        },
        "price": {
          "type": "number",
          "description": "Current price in USD"
        },
        "originalPrice": {
          "type": "number",
          "description": "Original price before discount"
        },
        "inStock": {
          "type": "boolean",
          "description": "Whether product is in stock"
        },
        "rating": {
          "type": "number",
          "description": "Average customer rating (0-5)"
        },
        "reviews": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "author": {"type": "string"},
              "rating": {"type": "number"},
              "comment": {"type": "string"}
            }
          },
          "description": "Top 3 customer reviews"
        }
      }
    },
    "temperature": 0.1,
    "options": {
      "useBrowser": true,
      "actions": [
        {"type": "click", "selector": ".show-reviews", "optional": true},
        {"type": "wait", "timeout": 2000}
      ]
    }
  }'
```

**Response Format:**
```json
{
  "success": true,
  "url": "https://example.com",
  "extractedData": {
    "productName": "Sample Product",
    "price": 29.99,
    "originalPrice": 39.99,
    "inStock": true,
    "rating": 4.5,
    "reviews": [...]
  },
  "loadTime": 2345,
  "fromCache": false,
  "llmTokensUsed": 1234
}
```

## 📦 Batch Processing

Process multiple URLs efficiently with controlled concurrency, automatic retries, and comprehensive download options.

### Start Batch Processing

```bash
curl -X POST https://deepscrapper.ai/api/batch/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "urls": [
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart",
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/deploy-vais-prompt", 
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview",
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/vertex-ai-studio-express-mode-quickstart",
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/vertex-ai-express-mode-api-quickstart"
    ],
    "concurrency": 3,
    "options": {
      "extractorFormat": "markdown",
      "waitForTimeout": 2000,
      "stealthMode": true
    }
  }'
```

Response:
```json
{
  "success": true,
  "batchId": "550e8400-e29b-41d4-a716-446655440000",
  "totalUrls": 5,
  "estimatedTime": 50000,
  "statusUrl": "https://deepscrapper.ai/api/batch/scrape/550e8400.../status"
}
```

### Monitor Batch Progress

```bash
curl -X GET https://deepscrapper.ai/api/batch/scrape/{batchId}/status \
  -H "X-API-Key: your-secret-key"
```

Response:
```json
{
  "success": true,
  "batchId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "totalUrls": 5,
  "completedUrls": 4,
  "failedUrls": 1,
  "progress": 100,
  "processingTime": 45230,
  "results": [...]
}
```

### Download Results

#### 1. Download as ZIP Archive (Recommended)
```bash
# Download all results as markdown files in a ZIP
curl -X GET "https://deepscrapper.ai/api/batch/scrape/{batchId}/download/zip?format=markdown" \
  -H "X-API-Key: your-secret-key" \
  --output "batch_results.zip"

# Extract the ZIP to get individual files
unzip batch_results.zip
```

ZIP Contents:
```
1_example_com_page1.md
2_example_com_page2.md  
3_example_com_page3.md
4_docs_example_com_api.md
batch_summary.json
```

#### 2. Download Individual Results
```bash
# Get job IDs from status endpoint, then download individual files
curl -X GET "https://deepscrapper.ai/api/batch/scrape/{batchId}/download/{jobId}?format=markdown" \
  -H "X-API-Key: your-secret-key" \
  --output "page1.md"
```

#### 3. Download Consolidated JSON
```bash
# All results in a single JSON file
curl -X GET "https://deepscrapper.ai/api/batch/scrape/{batchId}/download/json" \
  -H "X-API-Key: your-secret-key" \
  --output "batch_results.json"
```

### Advanced Batch Options

```bash
curl -X POST https://deepscrapper.ai/api/batch/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "urls": ["https://example.com", "https://example.org"],
    "concurrency": 5,
    "timeout": 300000,
    "maxRetries": 3,
    "failFast": false,
    "webhook": "https://your-app.com/webhook",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true,
      "waitForTimeout": 5000,
      "blockAds": true,
      "actions": [
        {"type": "click", "selector": ".accept-cookies", "optional": true},
        {"type": "wait", "timeout": 2000}
      ]
    }
  }'
```

### Cancel Batch Processing

```bash
curl -X DELETE https://deepscrapper.ai/api/batch/scrape/{batchId} \
  -H "X-API-Key: your-secret-key"
```

### Complete `/api/batch/scrape` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`urls`** (string[]): Array of URLs to scrape

**Optional Parameters:**
- **`concurrency`** (number, default: 5, max: 20): Number of concurrent scraping jobs
- **`timeout`** (number, default: 300000): Total batch timeout in milliseconds
- **`maxRetries`** (number, default: 3): Maximum retries per URL
- **`failFast`** (boolean, default: false): Stop batch on first failure
- **`webhook`** (string): URL to call when batch completes
- **`webhookHeaders`** (object): Custom headers for webhook request
- **`options`** (object): Scraper options applied to all URLs (same as `/api/scrape`)
- **`individualOptions`** (object): URL-specific options
  ```json
  {
    "https://example1.com": { "extractorFormat": "html" },
    "https://example2.com": { "useBrowser": true }
  }
  ```

#### **Sample API Calls**

**Advanced Batch with Individual Options:**
```bash
curl -X POST https://deepscrapper.ai/api/batch/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "urls": [
      "https://news-site.com/article1",
      "https://spa-app.com/dashboard",
      "https://pdf-site.com/document"
    ],
    "concurrency": 2,
    "maxRetries": 5,
    "webhook": "https://your-app.com/batch-complete",
    "options": {
      "extractorFormat": "markdown",
      "minDelay": 2000
    },
    "individualOptions": {
      "https://spa-app.com/dashboard": {
        "useBrowser": true,
        "waitForSelector": ".dashboard-loaded",
        "actions": [
          {"type": "wait", "timeout": 5000}
        ]
      },
      "https://pdf-site.com/document": {
        "extractorFormat": "text"
      }
    }
  }'
```

### Complete `/api/batch/scrape/:id/status` Options

#### **URL Parameters**
- **`:id`** (string): The batch ID returned from batch creation

#### **Query Parameters**
- **`includeResults`** (boolean, default: true): Include individual job results
- **`format`** (enum, default: "json"): Response format ("json" or "csv")
- **`limit`** (number): Limit number of results returned
- **`offset`** (number): Offset for pagination

#### **Sample API Calls**

**Get Paginated Results:**
```bash
curl -X GET "https://deepscrapper.ai/api/batch/scrape/550e8400.../status?limit=10&offset=20" \
  -H "X-API-Key: your-secret-key"
```

### Complete `/api/batch/scrape/:id/download/*` Options

#### **Endpoint Variations**
1. **`/download/zip`** - Download as ZIP archive
2. **`/download/json`** - Download as consolidated JSON
3. **`/download/:jobId`** - Download individual result

#### **Query Parameters**

**For ZIP Download:**
- **`format`** (enum, default: "markdown"): File format ("markdown", "html", "text", "json")
- **`includeMetadata`** (boolean, default: true): Include metadata file
- **`includeFailed`** (boolean, default: false): Include failed URLs info

**For JSON Download:**
- **`pretty`** (boolean, default: false): Pretty-print JSON
- **`includeMetadata`** (boolean, default: true): Include batch metadata

### Complete `/api/batch/scrape/:id` DELETE Options

#### **Query Parameters**
- **`force`** (boolean, default: false): Force cancel even if completing
- **`cleanup`** (boolean, default: true): Clean up partial results

**Force Cancel Example:**
```bash
curl -X DELETE "https://deepscrapper.ai/api/batch/scrape/550e8400...?force=true" \
  -H "X-API-Key: your-secret-key"
```

## 🕷️ Web Crawling

Start a multi-page crawl (automatically exports markdown files):

```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 50,
    "maxDepth": 3,
    "strategy": "bfs",
    "includePaths": ["^/docs/.*"],
    "scrapeOptions": {
      "extractorFormat": "markdown"
    }
  }'
```

**🚀 Enhanced Streaming Crawling** (Recommended for large sites):

```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 1000,
    "useMapDiscovery": true,
    "allowSubdomains": true,
    "includePaths": ["^/docs/.*", "^/api/.*"],
    "scrapeOptions": {
      "extractorFormat": "markdown"
    }
  }'
```

**🌟 Benefits of `useMapDiscovery: true` (Streaming Architecture + Browser Pool)**:
- **⚡ 90% faster crawling** (streaming + browser pool vs sequential discovery)
- **🏊 Browser pool management** (reuses 5 browser instances vs creating new ones)
- **🔄 Parallel processing** (5 discovery methods + scraping run simultaneously) 
- **📈 Higher success rate** (95%+ vs 85% with traditional crawling)
- **🎯 Comprehensive coverage** (sitemaps, browser crawling, common paths, robots.txt, search)
- **🧠 Intelligent filtering** (respects includePaths and excludePaths)
- **💾 Memory efficient** (streams URLs + browser reuse vs high memory usage)

### Complete `/api/crawl` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`url`** (string): The starting URL to crawl

**Core Crawl Control Options:**
- **`limit`** (integer, default: 100): Maximum number of URLs to crawl
- **`maxDepth`** (integer, default: 5): Maximum depth to crawl from starting URL
- **`includePaths`** (string[]): Array of regex patterns for URLs to include (legacy)
- **`excludePaths`** (string[]): Array of regex patterns for URLs to exclude (legacy)
- **`allowBackwardCrawling`** (boolean, default: false): Allow crawling URLs that aren't descendants of initial URL
- **`allowExternalContentLinks`** (boolean, default: false): Allow crawling external domain links
- **`allowSubdomains`** (boolean, default: false): Allow crawling subdomains
- **`ignoreRobotsTxt`** (boolean, default: false): Ignore robots.txt rules
- **`regexOnFullURL`** (boolean, default: false): Apply regex patterns to full URLs instead of just paths

**Strategy & Discovery Options:**
- **`strategy`** (enum): Crawling strategy
  - `"bfs"` (default): Breadth-First Search
  - `"dfs"`: Depth-First Search  
  - `"best_first"`: Best-First Search (prioritized)
- **`useBrowser`** (boolean, default: false): Use browser-based crawling with Playwright
- **`useMapDiscovery`** (boolean, default: false): 🚀 **Enable high-performance URL discovery** (finds 5,000+ URLs in seconds)

**Enhanced Map Discovery Options** (when `useMapDiscovery: true`):
- **`maxUrls`** (integer, default: 5000, max: 30000): Maximum URLs to discover (overrides `limit`)
- **`timeoutMs`** (integer, default: 120000, max: 300000): Discovery timeout in milliseconds
- **`skipSitemaps`** (boolean, default: false): Skip sitemap-based discovery (faster for browser-only discovery)
- **`sitemapsOnly`** (boolean, default: false): Use only sitemap-based discovery (fastest but limited)
- **`includePatterns`** (string[]): Include only URLs matching these path patterns (overrides `includePaths`)
- **`excludePatterns`** (string[]): Exclude URLs matching these patterns (overrides `excludePaths`)

**Advanced Crawl Options** (`crawlOptions` object when `useMapDiscovery: true`):
- **`maxCrawlDepth`** (number, default: 3, max: 5): Browser crawling depth for URL discovery
- **`maxConcurrentCrawlers`** (number, default: 8, max: 20): Concurrent browser crawlers for discovery
- **`crawlTimeoutPerPage`** (number, default: 3000, max: 10000): Timeout per page during discovery (ms)
- **`maxLinksPerPage`** (number, default: 100, max: 500): Maximum links to extract per page during discovery
- **`enableDeepCrawling`** (boolean, default: true): Enable multi-level crawling during discovery
- **`browserPoolSize`** (number, default: 5, max: 15): Browser pool size for discovery crawling

**Notification Options:**
- **`webhook`** (string): URL to call when crawl completes

#### **Scrape Options** (`scrapeOptions` object)

**Basic Scraping Options:**
- **`timeout`** (number): Request timeout in milliseconds
- **`extractorFormat`** (enum): Output format
  - `"html"`: Raw HTML
  - `"markdown"` (recommended): Clean markdown
  - `"text"`: Plain text only
- **`waitForTimeout`** (number): Time to wait after page loads (ms)
- **`waitForSelector`** (string): CSS selector to wait for before scraping (see detailed guide below)
- **`skipTlsVerification`** (boolean): Skip TLS verification for HTTPS

**Browser Options:**
- **`javascript`** (boolean): Enable JavaScript execution
- **`fullPage`** (boolean): Capture full page content
- **`stealthMode`** (boolean): Enable stealth mode to avoid detection
- **`maxScrolls`** (number): Maximum scrolls for dynamic content
- **`blockAds`** (boolean): Block advertisements
- **`blockResources`** (boolean): Block images/fonts/media for speed

**Authentication & Headers:**
- **`userAgent`** (string): Custom user agent
- **`cookies`** (object): Cookie key-value pairs
- **`headers`** (object): Custom HTTP headers

**Proxy Options:**
- **`proxy`** (string): Proxy URL
- **`proxyUsername`** (string): Proxy authentication username
- **`proxyPassword`** (string): Proxy authentication password
- **`proxyRotation`** (boolean): Enable proxy rotation
- **`proxyList`** (string[]): List of proxy URLs to rotate

**Rate Limiting Options:**
- **`minDelay`** (number): Minimum delay between requests (ms)
- **`maxDelay`** (number): Maximum delay for exponential backoff (ms)
- **`maxRetries`** (number): Maximum retries for failed requests
- **`backoffFactor`** (number): Exponential backoff multiplier
- **`rotateUserAgent`** (boolean): Rotate user agents between requests

**Browser Actions** (`actions` array):
Array of actions to perform on each page (see detailed browser actions guide below):
```javascript
{
  "type": "click|scroll|wait|fill|select|hover|keypress",
  "selector": "CSS selector",
  "value": "value for fill/select",
  "position": 1000,  // pixels for scroll
  "timeout": 5000,   // ms for wait
  "optional": true   // don't fail if action fails
}
```

**Caching Options:**
- **`skipCache`** (boolean): Skip cache for this request
- **`cacheTtl`** (number): Custom cache TTL in seconds

### **`waitForSelector` - Detailed Guide**

The `waitForSelector` option is a **browser automation feature** that tells DeepScraper to wait for a specific CSS selector to appear on the page before starting to scrape the content.

#### **What It Does:**
- **Waits for dynamic content** to load (JavaScript-rendered elements)
- **Ensures elements exist** before scraping begins
- **Prevents incomplete scraping** of single-page applications (SPAs)
- **Handles asynchronous loading** (AJAX, lazy loading, etc.)

#### **When to Use:**
1. **Single Page Applications (SPAs)** - React, Vue, Angular apps
2. **Dynamic content loading** - Content loaded via JavaScript
3. **Lazy loading** - Images, content that loads on scroll
4. **Cookie banners** - Wait for accept/dismiss buttons
5. **Authentication flows** - Wait for login forms
6. **API-driven content** - Wait for data to load from APIs

#### **CSS Selector Examples:**

**By Class:**
```json
{"waitForSelector": ".content-loaded"}
```

**By ID:**
```json
{"waitForSelector": "#main-article"}
```

**By Tag:**
```json
{"waitForSelector": "article"}
```

**By Attribute:**
```json
{"waitForSelector": "[data-loaded='true']"}
```

**Complex Selectors:**
```json
{"waitForSelector": ".post-content h1"}
```

#### **Common Selectors for Different Sites:**

| Site Type | Common Selector | Purpose |
|-----------|----------------|---------|
| **WordPress** | `.entry-content`, `.post-content` | Main article content |
| **Medium** | `.postArticle-content` | Article body |
| **GitHub** | `.markdown-body` | Documentation content |
| **Stack Overflow** | `.post-text` | Question/answer content |
| **Documentation** | `.content`, `.docs-content` | Main documentation |
| **E-commerce** | `.product-details`, `.product-info` | Product information |
| **News Sites** | `.article-body`, `.story-content` | Article content |

#### **Practical Examples:**

**WordPress Blog (Dynamic Content):**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://blog.example.com/post/123",
    "options": {
      "extractorFormat": "markdown",
      "waitForSelector": ".post-content",
      "waitForTimeout": 5000
    }
  }'
```

**E-commerce Product Page:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://shop.example.com/product/123",
    "options": {
      "extractorFormat": "markdown",
      "waitForSelector": ".product-details",
      "waitForTimeout": 10000
    }
  }'
```

**Documentation Site (React/SPA):**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.react-app.com",
    "limit": 50,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "waitForSelector": ".docs-content",
      "waitForTimeout": 8000
    }
  }'
```

**News Site with Cookie Banner:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://news.example.com/article/123",
    "options": {
      "extractorFormat": "markdown",
      "waitForSelector": ".article-body",
      "actions": [
        {"type": "click", "selector": ".accept-cookies", "optional": true},
        {"type": "wait", "timeout": 2000}
      ]
    }
  }'
```

#### **Best Practices:**

**1. Use Specific Selectors:**
```json
// Good - specific
{"waitForSelector": ".main-article-content"}

// Avoid - too generic
{"waitForSelector": "div"}
```

**2. Combine with Timeout:**
```json
{
  "waitForSelector": ".content-loaded",
  "waitForTimeout": 10000  // 10 seconds max wait
}
```

**3. Use with Browser Mode:**
```json
{
  "useBrowser": true,
  "waitForSelector": ".dynamic-content",
  "javascript": true
}
```

#### **Troubleshooting:**

**If Content Still Missing:**
1. **Increase timeout**: Some content takes longer to load
2. **Check selector**: Use browser dev tools to verify CSS selector
3. **Wait for multiple elements**: Use actions to wait for sequential loading
4. **Add scroll actions**: Some content loads on scroll

**Example with Multiple Waits:**
```json
{
  "waitForSelector": ".initial-content",
  "actions": [
    {"type": "wait", "timeout": 2000},
    {"type": "scroll", "position": 1000},
    {"type": "wait", "timeout": 3000}
  ]
}
```

#### **Performance Notes:**
- **Default timeout**: Usually 30 seconds if not specified
- **Faster scraping**: Use specific selectors to avoid long waits
- **Combine with actions**: For complex loading sequences

### **Browser Actions - Complete Guide**

Browser actions allow you to simulate user interactions on web pages before scraping. This is essential for modern web applications that require user interaction to load content.

#### **🎯 What Browser Actions Do:**
- **Interact with dynamic content** - Click buttons, fill forms, scroll pages
- **Handle authentication** - Login to protected areas
- **Navigate single-page applications** - Trigger page transitions  
- **Load lazy content** - Scroll to trigger content loading
- **Dismiss popups** - Handle cookie banners, ads, modals
- **Simulate real user behavior** - Avoid detection by bot protection

#### **🔧 Available Action Types**

**1. Click Actions (`click`)**
- **Purpose**: Click buttons, links, or any clickable elements
- **When to use**: Cookie banners, navigation, load more buttons, login forms
- **Required**: `selector`
- **Optional**: `optional` (don't fail if element not found)

```json
{"type": "click", "selector": ".accept-cookies"}
{"type": "click", "selector": "#load-more-btn", "optional": true}
{"type": "click", "selector": "button[data-action='submit']"}
```

**2. Scroll Actions (`scroll`)**
- **Purpose**: Scroll the page to load lazy content or reach specific sections
- **When to use**: Infinite scroll pages, lazy loading, long articles
- **Required**: `position` (pixels from top)
- **Optional**: `optional`

```json
{"type": "scroll", "position": 1000}
{"type": "scroll", "position": 500, "optional": true}
{"type": "scroll", "position": 0}  // Scroll to top
```

**3. Wait Actions (`wait`)**
- **Purpose**: Pause execution to allow content to load
- **When to use**: After other actions, for slow-loading content, API calls
- **Required**: `timeout` (milliseconds)
- **Optional**: None

```json
{"type": "wait", "timeout": 3000}
{"type": "wait", "timeout": 5000}
```

**4. Fill Actions (`fill`)**
- **Purpose**: Fill input fields with text
- **When to use**: Login forms, search boxes, contact forms
- **Required**: `selector`, `value`
- **Optional**: `optional`

```json
{"type": "fill", "selector": "#username", "value": "testuser"}
{"type": "fill", "selector": "input[name='email']", "value": "test@example.com"}
{"type": "fill", "selector": "#search-box", "value": "search term", "optional": true}
```

**5. Select Actions (`select`)**
- **Purpose**: Select options from dropdown menus
- **When to use**: Form dropdowns, filters, category selectors
- **Required**: `selector`, `value`
- **Optional**: `optional`

```json
{"type": "select", "selector": "#country", "value": "United States"}
{"type": "select", "selector": "select[name='category']", "value": "technology"}
{"type": "select", "selector": ".filter-dropdown", "value": "newest", "optional": true}
```

**6. Hover Actions (`hover`)**
- **Purpose**: Hover over elements to trigger dropdown menus or tooltips
- **When to use**: Navigation menus, tooltip content, hover effects
- **Required**: `selector`
- **Optional**: `optional`

```json
{"type": "hover", "selector": ".menu-item"}
{"type": "hover", "selector": "#info-icon", "optional": true}
{"type": "hover", "selector": "nav .dropdown-trigger"}
```

**7. Key Press Actions (`keypress`)**
- **Purpose**: Send keyboard inputs like Enter, Tab, Escape
- **When to use**: Form submission, navigation, dismissing modals
- **Required**: `value` (key name)
- **Optional**: `optional`

```json
{"type": "keypress", "value": "Enter"}
{"type": "keypress", "value": "Escape"}
{"type": "keypress", "value": "Tab"}
{"type": "keypress", "value": "ArrowDown", "optional": true}
```

#### **📝 Action Sequence Examples**

**Login Flow:**
```json
{
  "actions": [
    {"type": "fill", "selector": "#username", "value": "your-username"},
    {"type": "fill", "selector": "#password", "value": "your-password"},
    {"type": "click", "selector": "#login-btn"},
    {"type": "wait", "timeout": 3000}
  ]
}
```

**Cookie Banner + Content Loading:**
```json
{
  "actions": [
    {"type": "click", "selector": ".accept-cookies", "optional": true},
    {"type": "wait", "timeout": 2000},
    {"type": "scroll", "position": 1000},
    {"type": "wait", "timeout": 3000}
  ]
}
```

**Search and Load Results:**
```json
{
  "actions": [
    {"type": "fill", "selector": "#search-input", "value": "my search term"},
    {"type": "keypress", "value": "Enter"},
    {"type": "wait", "timeout": 5000},
    {"type": "click", "selector": ".load-more", "optional": true}
  ]
}
```

**Infinite Scroll Loading:**
```json
{
  "actions": [
    {"type": "scroll", "position": 1000},
    {"type": "wait", "timeout": 2000},
    {"type": "scroll", "position": 2000},
    {"type": "wait", "timeout": 2000},
    {"type": "scroll", "position": 3000},
    {"type": "wait", "timeout": 2000}
  ]
}
```

**Navigation Menu Interaction:**
```json
{
  "actions": [
    {"type": "hover", "selector": ".main-nav"},
    {"type": "wait", "timeout": 1000},
    {"type": "click", "selector": ".dropdown-item"},
    {"type": "wait", "timeout": 3000}
  ]
}
```

#### **🌐 Real-World Use Cases**

**E-commerce Product Pages:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://shop.example.com/product/123",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "actions": [
        {"type": "click", "selector": ".cookie-accept", "optional": true},
        {"type": "wait", "timeout": 2000},
        {"type": "scroll", "position": 1000},
        {"type": "click", "selector": ".show-reviews", "optional": true},
        {"type": "wait", "timeout": 3000}
      ]
    }
  }'
```

**Social Media Feeds:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://social.example.com/feed",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true,
      "actions": [
        {"type": "scroll", "position": 1000},
        {"type": "wait", "timeout": 2000},
        {"type": "scroll", "position": 2000},
        {"type": "wait", "timeout": 2000},
        {"type": "click", "selector": ".load-more", "optional": true},
        {"type": "wait", "timeout": 5000}
      ]
    }
  }'
```

**News Sites with Paywalls:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://news.example.com/article/123",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "actions": [
        {"type": "click", "selector": ".cookie-banner .accept", "optional": true},
        {"type": "wait", "timeout": 2000},
        {"type": "keypress", "value": "Escape", "optional": true},
        {"type": "wait", "timeout": 1000},
        {"type": "scroll", "position": 1000}
      ]
    }
  }'
```

**Single Page Applications (SPAs):**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://spa-app.com",
    "limit": 50,
    "useBrowser": true,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "javascript": true,
      "waitForSelector": ".content-loaded",
      "actions": [
        {"type": "wait", "timeout": 3000},
        {"type": "click", "selector": ".nav-docs", "optional": true},
        {"type": "wait", "timeout": 2000},
        {"type": "scroll", "position": 500}
      ]
    }
  }'
```

**Search Results Pages:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://search.example.com",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "actions": [
        {"type": "fill", "selector": "#search-box", "value": "my search query"},
        {"type": "keypress", "value": "Enter"},
        {"type": "wait", "timeout": 5000},
        {"type": "click", "selector": ".show-more-results", "optional": true},
        {"type": "wait", "timeout": 3000}
      ]
    }
  }'
```

#### **⚙️ Advanced Action Patterns**

**Progressive Loading:**
```json
{
  "actions": [
    {"type": "scroll", "position": 1000},
    {"type": "wait", "timeout": 2000},
    {"type": "scroll", "position": 2000},
    {"type": "wait", "timeout": 2000},
    {"type": "scroll", "position": 3000},
    {"type": "wait", "timeout": 3000}
  ]
}
```

**Modal Handling:**
```json
{
  "actions": [
    {"type": "wait", "timeout": 2000},
    {"type": "keypress", "value": "Escape", "optional": true},
    {"type": "click", "selector": ".modal-close", "optional": true},
    {"type": "click", "selector": ".overlay", "optional": true},
    {"type": "wait", "timeout": 1000}
  ]
}
```

**Multi-Step Form:**
```json
{
  "actions": [
    {"type": "fill", "selector": "#first-name", "value": "John"},
    {"type": "fill", "selector": "#last-name", "value": "Doe"},
    {"type": "select", "selector": "#country", "value": "United States"},
    {"type": "click", "selector": "#next-step"},
    {"type": "wait", "timeout": 3000},
    {"type": "fill", "selector": "#email", "value": "john@example.com"},
    {"type": "click", "selector": "#submit"}
  ]
}
```

#### **🔍 Selector Best Practices**

**Use Specific Selectors:**
```json
// Good - specific and reliable
{"type": "click", "selector": "#accept-cookies-btn"}
{"type": "click", "selector": "[data-testid='load-more']"}
{"type": "click", "selector": ".cookie-banner .accept-btn"}

// Avoid - too generic, might match wrong elements
{"type": "click", "selector": "button"}
{"type": "click", "selector": "div"}
```

**CSS Selector Examples:**
- **By ID**: `#element-id`
- **By Class**: `.class-name`
- **By Attribute**: `[data-action='submit']`
- **By Text**: `button:contains('Load More')`
- **Descendant**: `.parent .child`
- **Child**: `.parent > .child`
- **Pseudo**: `button:first-child`

#### **⚠️ Error Handling & Best Practices**

**Use Optional Actions:**
```json
{
  "actions": [
    {"type": "click", "selector": ".accept-cookies", "optional": true},
    {"type": "click", "selector": ".close-modal", "optional": true},
    {"type": "wait", "timeout": 2000}
  ]
}
```

**Add Sufficient Waits:**
```json
{
  "actions": [
    {"type": "click", "selector": ".load-content"},
    {"type": "wait", "timeout": 5000},  // Give time for content to load
    {"type": "scroll", "position": 1000}
  ]
}
```

**Handle Different Page States:**
```json
{
  "actions": [
    {"type": "click", "selector": ".cookie-accept", "optional": true},
    {"type": "click", "selector": ".popup-close", "optional": true},
    {"type": "keypress", "value": "Escape", "optional": true},
    {"type": "wait", "timeout": 2000}
  ]
}
```

#### **📊 Performance Tips**

**Optimize Wait Times:**
- Use specific `waitForSelector` instead of long waits
- Only wait as long as necessary
- Use shorter waits for simple actions

**Minimize Actions:**
- Only include necessary actions
- Combine related actions
- Test with minimal action sets first

**Error Recovery:**
- Mark non-critical actions as optional
- Add fallback actions for different page states
- Use escape key to dismiss unknown modals

#### **🚀 Complete Example - E-commerce Crawl with Actions**

```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://ecommerce-site.com/products",
    "useMapDiscovery": true,
    "maxUrls": 200,
    "includePatterns": ["/product/", "/category/"],
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true,
      "waitForSelector": ".product-info",
      "actions": [
        {"type": "click", "selector": ".cookie-accept", "optional": true},
        {"type": "wait", "timeout": 2000},
        {"type": "keypress", "value": "Escape", "optional": true},
        {"type": "scroll", "position": 1000},
        {"type": "wait", "timeout": 3000},
        {"type": "click", "selector": ".load-reviews", "optional": true},
        {"type": "wait", "timeout": 2000},
        {"type": "scroll", "position": 2000}
      ],
      "minDelay": 2000,
      "maxRetries": 3
    }
  }'
```

This will crawl the e-commerce site while:
1. Accepting cookie banners
2. Dismissing any popups with Escape key  
3. Scrolling to load lazy content
4. Loading product reviews if available
5. Ensuring proper delays between actions

### **Proxy Usage - Complete Guide**

Proxies act as intermediaries between your scraper and target websites, helping you avoid IP blocking, bypass geo-restrictions, and scale your scraping operations.

#### **🔍 Why Use Proxies?**
- **Avoid IP blocking** - Rotate different IP addresses
- **Bypass geo-restrictions** - Access content from different countries  
- **Scale scraping** - Make more requests without rate limits
- **Stay anonymous** - Hide your real IP address
- **Avoid detection** - Distribute requests across multiple IPs

#### **🛒 Where to Get Proxies**

**Residential Proxy Providers (Recommended for Scraping):**
- **Bright Data** (formerly Luminati) - Industry leader, expensive but reliable
- **Oxylabs** - High-quality residential proxies
- **Smartproxy** - Good balance of price/quality ($25-75/month)
- **Proxy-Cheap** - Budget-friendly option ($2-20/month)
- **NetNut** - Fast residential proxies

**Datacenter Proxy Providers (Cheaper, Less Reliable):**
- **ProxyMesh** - Simple HTTP proxies ($10-50/month)
- **Storm Proxies** - Rotating datacenter proxies ($50-200/month)
- **MyPrivateProxy** - Dedicated datacenter proxies ($1-5/proxy/month)

**Typical Pricing:**
- **Residential Proxies**: $5-15 per GB of traffic
- **Datacenter Proxies**: $1-5 per proxy per month
- **Rotating Proxies**: $50-200 per month for unlimited

#### **🔧 Basic Proxy Usage**

**Single Proxy:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://example.com",
    "options": {
      "extractorFormat": "markdown",
      "proxy": "http://proxy-server.com:8080"
    }
  }'
```

**Proxy with Authentication:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://example.com",
    "options": {
      "extractorFormat": "markdown",
      "proxy": "http://proxy-server.com:8080",
      "proxyUsername": "your-username",
      "proxyPassword": "your-password"
    }
  }'
```

#### **🔄 Proxy Rotation (Multiple Proxies)**

```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://target-site.com",
    "limit": 100,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "proxyRotation": true,
      "proxyList": [
        "http://proxy1.example.com:8080",
        "http://proxy2.example.com:8080",
        "http://proxy3.example.com:8080",
        "http://proxy4.example.com:8080"
      ],
      "proxyUsername": "your-username",
      "proxyPassword": "your-password"
    }
  }'
```

#### **🌍 Real-World Provider Examples**

**Bright Data (Premium Residential):**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://protected-ecommerce-site.com",
    "useMapDiscovery": true,
    "maxUrls": 500,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true,
      "proxy": "zproxy.lum-superproxy.io:22225",
      "proxyUsername": "brd-customer-hl_your-id-zone-residential",
      "proxyPassword": "your-password"
    }
  }'
```

**Oxylabs Residential:**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://geo-restricted-site.com",
    "options": {
      "extractorFormat": "markdown",
      "proxy": "pr.oxylabs.io:7777",
      "proxyUsername": "customer-your-username-cc-US",
      "proxyPassword": "your-password"
    }
  }'
```

**Smartproxy (Budget-Friendly):**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://target-site.com",
    "limit": 50,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "proxyRotation": true,
      "proxyList": ["gate.smartproxy.com:7000"],
      "proxyUsername": "user-session-rand10000000",
      "proxyPassword": "your-password",
      "minDelay": 2000
    }
  }'
```

#### **🎯 Specific Use Cases**

**Scraping E-commerce (Amazon, eBay):**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://amazon.com/dp/B08N5WRWNW",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true,
      "proxy": "residential-proxy.provider.com:8080",
      "proxyUsername": "user-session-country-US",
      "proxyPassword": "your-password",
      "waitForSelector": ".product-title",
      "minDelay": 3000,
      "maxRetries": 3
    }
  }'
```

**High-Volume Scraping with Rotation:**
```bash
curl -X POST https://deepscrapper.ai/api/batch/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "urls": ["https://site1.com", "https://site2.com", "https://site3.com"],
    "concurrency": 5,
    "options": {
      "extractorFormat": "markdown",
      "proxyRotation": true,
      "proxyList": [
        "http://datacenter1.proxymesh.com:31280",
        "http://datacenter2.proxymesh.com:31280",
        "http://datacenter3.proxymesh.com:31280"
      ],
      "proxyUsername": "your-username",
      "proxyPassword": "your-password",
      "minDelay": 1000
    }
  }'
```

#### **📋 Proxy Setup Checklist**

**Before You Start:**
1. **Choose a proxy provider** based on your budget and needs
2. **Sign up and get credentials** (username, password, endpoints)
3. **Test proxy connectivity** with a simple request
4. **Check IP rotation** to ensure proxies are working
5. **Monitor usage and costs** to avoid overage charges

**Proxy URL Formats:**
- **HTTP**: `http://proxy-server.com:8080`
- **HTTPS**: `https://proxy-server.com:8080`
- **SOCKS5**: `socks5://proxy-server.com:1080`
- **With Auth**: `http://username:password@proxy-server.com:8080`

**Testing Your Proxy:**
```bash
# Test proxy connectivity
curl -x "http://your-proxy:8080" \
     -U "username:password" \
     "http://httpbin.org/ip"
```

#### **🚀 Recommended Setup for Beginners**

**Step 1: Start with Smartproxy**
1. Sign up at smartproxy.com
2. Choose residential endpoints ($25/month plan)
3. Get your credentials

**Step 2: Test Basic Setup**
```bash
curl -X POST https://deepscrapper.ai/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://httpbin.org/ip",
    "options": {
      "proxy": "gate.smartproxy.com:7000",
      "proxyUsername": "your-username",
      "proxyPassword": "your-password"
    }
  }'
```

**Step 3: Scale with Crawling**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://target-site.com",
    "useMapDiscovery": true,
    "maxUrls": 100,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "proxy": "gate.smartproxy.com:7000",
      "proxyUsername": "user-session-rand10000000",
      "proxyPassword": "your-password",
      "minDelay": 2000
    }
  }'
```

#### **⚠️ Important Considerations**

**Legal and Ethical:**
- **Check robots.txt** - Respect website scraping policies
- **Rate limiting** - Don't overload target servers
- **Terms of service** - Ensure scraping is allowed
- **Data privacy** - Handle scraped data responsibly

**Technical Best Practices:**
- **Use residential proxies** for strict sites (Amazon, Google, etc.)
- **Rotate proxies frequently** - Avoid detection patterns
- **Monitor proxy health** - Replace dead proxies
- **Combine with delays** - Don't scrape too aggressively

**Cost Optimization:**
- **Start small** - Test with limited proxy pools
- **Monitor bandwidth** - Residential proxies charge per GB
- **Use datacenter for simple sites** - Much cheaper
- **Pool sharing** - Some providers offer shared pools

#### **Sample API Calls**

**Basic Crawl:**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 100,
    "maxDepth": 3
  }'
```

**High-Performance Discovery Crawl with Enhanced Options:**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://docs.oracle.com/en-us/iaas/Content/home.htm",
    "useMapDiscovery": true,
    "maxUrls": 5000,
    "timeoutMs": 300000,
    "allowSubdomains": true,
    "includePatterns": ["/en-us/iaas/"],
    "excludePatterns": ["/archive/", "/old/"],
    "crawlOptions": {
      "maxCrawlDepth": 3,
      "maxConcurrentCrawlers": 10,
      "crawlTimeoutPerPage": 5000,
      "enableDeepCrawling": true,
      "browserPoolSize": 8
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "waitForTimeout": 3000,
      "blockAds": true
    }
  }'
```

**Fast Discovery Crawl (Browser-Only, 10x Faster):**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://firecrawl.dev",
    "useMapDiscovery": true,
    "maxUrls": 100,
    "timeoutMs": 30000,
    "skipSitemaps": true,
    "includePatterns": ["/blog/", "/docs/"],
    "crawlOptions": {
      "maxCrawlDepth": 2,
      "maxConcurrentCrawlers": 5,
      "enableDeepCrawling": true
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true
    }
  }'
```

**Conservative Discovery Crawl (Rate-Limited):**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://docs.github.com",
    "useMapDiscovery": true,
    "maxUrls": 500,
    "timeoutMs": 120000,
    "includePatterns": ["/api/", "/guides/"],
    "crawlOptions": {
      "maxCrawlDepth": 2,
      "maxConcurrentCrawlers": 2,
      "crawlTimeoutPerPage": 8000,
      "enableDeepCrawling": false
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "minDelay": 2000,
      "maxRetries": 3
    }
  }'
```

**Advanced Browser Crawl with Actions:**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://spa-app.com",
    "limit": 200,
    "useBrowser": true,
    "strategy": "bfs",
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "javascript": true,
      "stealthMode": true,
      "actions": [
        {"type": "wait", "timeout": 2000},
        {"type": "scroll", "position": 1000},
        {"type": "click", "selector": ".load-more", "optional": true}
      ]
    }
  }'
```

**Filtered Crawl with Rate Limiting:**
```bash
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://blog.example.com",
    "limit": 1000,
    "includePaths": ["/posts/", "/articles/"],
    "excludePaths": ["/admin/", "/login/"],
    "allowSubdomains": false,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "minDelay": 1000,
      "maxRetries": 3,
      "userAgent": "Custom Bot 1.0"
    }
  }'
```

Response includes output directory:
```json
{
  "success": true,
  "id": "abc123-def456",
  "url": "https://deepscrapper.ai/api/crawl/abc123-def456",
  "message": "Crawl initiated successfully. Individual pages will be exported as markdown files.",
  "outputDirectory": "./crawl-output/abc123-def456"
}
```

Check crawl status (includes exported files info):

```bash
curl https://deepscrapper.ai/api/crawl/{job-id} \
  -H "X-API-Key: your-secret-key"
```

Status response shows exported files:
```json
{
  "success": true,
  "status": "completed",
  "crawl": {...},
  "jobs": [...],
  "count": 15,
  "exportedFiles": {
    "count": 15,
    "outputDirectory": "./crawl-output/abc123-def456",
    "files": ["./crawl-output/abc123-def456/2024-01-15_abc123_example.com_page1.md", ...]
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scrape` | POST | Scrape single URL (supports `formats`, `cssSchema`, `preferHttpScraper`) |
| `/api/extract-schema` | POST | LLM structured extraction (schema-validated, chunked) |
| `/api/summarize` | POST | Generate content summary |
| `/api/search` | POST | **Web search** (Serper/SearXNG/DuckDuckGo) + optional scrape |
| `/api/map` | POST | **Discover URLs (High-Performance)** — supports `includeSubdomains` |
| `/api/map/cache/stats` | GET | Get URL discovery cache stats |
| `/api/map/cache/clear` | POST | Clear URL discovery cache |
| `/api/map/health` | GET | Map service health check |
| `/api/batch/scrape` | POST | Start batch processing |
| `/api/batch/scrape/:id/status` | GET | Get batch status |
| `/api/batch/scrape/:id/download/zip` | GET | Download batch as ZIP |
| `/api/batch/scrape/:id/download/json` | GET | Download batch as JSON |
| `/api/batch/scrape/:id/download/:jobId` | GET | Download individual result |
| `/api/batch/scrape/:id` | DELETE | Cancel batch processing |
| `/api/crawl` | POST | Start web crawl (`useMapDiscovery`, `strategy:"best_first"`, `keywords`) |
| `/api/crawl/:id` | GET | Get crawl status + progress |
| `/api/crawl/:id/stream` | GET | **Stream crawl pages as Server-Sent Events** |
| `/api/crawl/:id/download/zip` | GET | **Download crawl markdown as ZIP** |
| `/api/crawl/:id/download/json` | GET | **Download crawl as consolidated JSON** |
| `/api/crawl/:id` | DELETE | Cancel a running crawl |
| `/api/cache` | DELETE | Clear cache |
| `/health` | GET | Liveness probe (no auth) |
| `/health/ready` | GET | Readiness probe — checks Redis (no auth) |
| `/metrics` | GET | Prometheus metrics (no auth) |

### Complete `/api/crawl/:id` Options

#### **Description**
GET endpoint to check crawl job status and results.

#### **URL Parameters**
- **`:id`** (string): The crawl job ID

#### **Query Parameters**
- **`includeJobs`** (boolean, default: true): Include individual job details
- **`format`** (enum, default: "json"): Response format ("json" or "summary")
- **`limit`** (number): Limit job results
- **`offset`** (number): Offset for pagination

#### **Sample API Calls**

**Get Full Crawl Status:**
```bash
curl -X GET "https://deepscrapper.ai/api/crawl/abc123-def456" \
  -H "X-API-Key: your-secret-key"
```

**Get Summary Only:**
```bash
curl -X GET "https://deepscrapper.ai/api/crawl/abc123-def456?format=summary" \
  -H "X-API-Key: your-secret-key"
```

**Response Format:**
```json
{
  "success": true,
  "status": "completed",
  "crawl": {
    "id": "abc123-def456",
    "url": "https://example.com",
    "totalPages": 847,
    "completedPages": 845,
    "failedPages": 2
  },
  "exportedFiles": {
    "count": 845,
    "outputDirectory": "./crawl-output/abc123-def456"
  }
}
```

### Complete `/api/cache` Options

#### **Description**
DELETE endpoint to clear the cache.

#### **Query Parameters**
- **`pattern`** (string): URL pattern to match for selective clearing
- **`type`** (enum): Cache type to clear ("all", "scrape", "map")
- **`olderThan`** (number): Clear entries older than X seconds
- **`force`** (boolean, default: false): Force clear without confirmation

#### **Sample API Calls**

**Clear All Cache:**
```bash
curl -X DELETE "https://deepscrapper.ai/api/cache" \
  -H "X-API-Key: your-secret-key"
```

**Clear Specific Pattern:**
```bash
curl -X DELETE "https://deepscrapper.ai/api/cache?pattern=example.com/*" \
  -H "X-API-Key: your-secret-key"
```

**Response Format:**
```json
{
  "success": true,
  "message": "Cache cleared successfully",
  "clearedEntries": 1523,
  "freedSpace": "152MB"
}
```

### Complete `/api/map/cache/stats` Options

#### **Description**
GET endpoint to retrieve URL discovery cache statistics.

#### **Query Parameters**
- **`detailed`** (boolean, default: false): Include detailed breakdown
- **`groupBy`** (enum): Group statistics by ("domain", "date", "size")

#### **Sample API Calls**

**Get Detailed Stats by Domain:**
```bash
curl -X GET "https://deepscrapper.ai/api/map/cache/stats?detailed=true&groupBy=domain" \
  -H "X-API-Key: your-secret-key"
```

**Response Format:**
```json
{
  "success": true,
  "stats": {
    "totalEntries": 523,
    "totalSize": "45.2MB",
    "hitRate": 0.85
  },
  "breakdown": {
    "example.com": {
      "entries": 125,
      "size": "12.3MB"
    }
  }
}
```

### Complete `/api/map/cache/clear` Options

#### **Description**
POST endpoint to clear URL discovery cache.

#### **Request Body Parameters**
- **`domains`** (string[]): Specific domains to clear
- **`patterns`** (string[]): URL patterns to match
- **`olderThan`** (string): ISO date to clear entries older than
- **`confirmClear`** (boolean, default: false): Confirmation flag

#### **Sample API Calls**

**Clear Specific Domains:**
```bash
curl -X POST "https://deepscrapper.ai/api/map/cache/clear" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "domains": ["example.com", "test.com"],
    "confirmClear": true
  }'
```

### Complete `/api/map/health` Options

#### **Description**
GET endpoint to check URL discovery service health.

#### **Query Parameters**
- **`verbose`** (boolean, default: false): Include detailed health metrics
- **`checkDependencies`** (boolean, default: true): Check external dependencies

#### **Sample API Calls**

**Verbose Health Check:**
```bash
curl -X GET "https://deepscrapper.ai/api/map/health?verbose=true" \
  -H "X-API-Key: your-secret-key"
```

**Response Format:**
```json
{
  "success": true,
  "status": "healthy",
  "uptime": 864000,
  "metrics": {
    "requestsPerMinute": 45,
    "averageResponseTime": 2340,
    "cacheHitRate": 0.85
  }
}
```

## ⚙️ Configuration Options

### Environment Variables

```env
# Core
API_KEY=your-secret-key
PORT=3000

# OpenAI
OPENAI_API_KEY=your-key
OPENAI_DEPLOYMENT_NAME=gpt-4o
LLM_TEMPERATURE=0.2

# Cache
CACHE_ENABLED=true
CACHE_TTL=3600
CACHE_DIRECTORY=./cache

# Redis (for job queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# Crawl file export
CRAWL_OUTPUT_DIR=./crawl-output
```

### Scraper Options

```typescript
interface ScraperOptions {
  extractorFormat?: 'html' | 'markdown' | 'text'
  waitForSelector?: string
  waitForTimeout?: number
  actions?: BrowserAction[]  // click, scroll, wait, fill
  skipCache?: boolean
  cacheTtl?: number
  stealthMode?: boolean
  proxy?: string
  userAgent?: string
}
```

### Crawler Options

```typescript
interface CrawlRequest {
  url: string
  includePaths?: string[]
  excludePaths?: string[]
  limit?: number                    // Default: 100
  maxDepth?: number                 // Default: 5
  allowBackwardCrawling?: boolean
  allowExternalContentLinks?: boolean
  allowSubdomains?: boolean
  ignoreRobotsTxt?: boolean
  regexOnFullURL?: boolean
  scrapeOptions?: ScraperOptions
  webhook?: string
  strategy?: 'bfs' | 'dfs' | 'best_first'
  useBrowser?: boolean
  useMapDiscovery?: boolean         // 🆕 Enable 60x faster URL discovery
}
```

## Docker Deployment

```bash
# Build and run
docker build -t deepscrape .
docker run -d -p 3000:3000 --env-file .env deepscrape

# Or use docker-compose
docker-compose up -d
```

## 🔄 Combining URL Discovery with Scraping

The `/api/map` endpoint works seamlessly with existing scraping workflows for maximum efficiency:

### 1. Discovery + Batch Scraping
```bash
# Step 1: Discover URLs (fast)
URLS=$(curl -s -X POST https://deepscrapper.ai/api/map \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://docs.example.com", "maxUrls": 100}' | \
  jq -r '.data.links[]')

# Step 2: Batch scrape discovered URLs
curl -X POST https://deepscrapper.ai/api/batch/scrape \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d "{\"urls\": $(echo $URLS | jq -R -s -c 'split(\"\n\")[:-1]')}"
```

### 2. Discovery + Targeted Crawling
```bash
# Use discovery to set optimal crawl limits
curl -X POST https://deepscrapper.ai/api/map \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "includePatterns": ["api", "guides"],
    "maxUrls": 500
  }' | jq '.data.total'  # Returns actual discoverable count

# Then crawl with appropriate limit
curl -X POST https://deepscrapper.ai/api/crawl \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 500,
    "includePaths": ["^/api/.*", "^/guides/.*"]
  }'
```

### 3. Endpoint Comparison & Expected Outputs

| Endpoint | Purpose | Output | Performance | Use Case |
|----------|---------|---------|-------------|----------|
| **`/api/map`** | URL Discovery Only | **List of URLs** (no content) | 5,000+ URLs in 2-3 seconds | Find URLs before scraping |
| **`/api/crawl`** | Crawl + Scrape | **Scraped content files** | 100 URLs in 2-5 minutes | Traditional approach |
| **`/api/crawl` + `useMapDiscovery`** | **Enhanced Discovery + Scraping** | **Scraped content files** | **1,000+ URLs in 30-60 seconds** | **🚀 Recommended approach** |
| **`/api/batch/scrape`** | Parallel scraping | **Scraped content files** | Any number of URLs | Scrape known URL lists |

### 4. Expected Outputs

**`/api/map` Output** (URLs only):
```json
{
  "success": true,
  "data": {
    "links": [
      "https://docs.example.com/api/auth",
      "https://docs.example.com/api/users",
      "https://docs.example.com/guides/quickstart"
    ],
    "total": 1247,
    "timeTaken": 2340
  }
}
```

**`/api/crawl` Output** (Scraped files):
```json
{
  "success": true,
  "status": "completed",
  "exportedFiles": {
    "count": 15,
    "outputDirectory": "./crawl-output/abc123-def456",
    "files": [
      "./crawl-output/abc123-def456/2024-01-15_abc123_example.com_api-auth.md",
      "./crawl-output/abc123-def456/2024-01-15_abc123_example.com_api-users.md"
    ]
  }
}
```

### 5. Performance Comparison

| Workflow | Discovery + Scraping | Total URLs | Success Rate | Architecture |
|----------|---------------------|------------|--------------|--------------|
| **Traditional Crawl** | 2-5 minutes | 100 URLs | 85% (limited by timeouts) | Sequential |
| **Enhanced Discovery Crawl** | **30-60 seconds** | **1,000+ URLs** | **95%+ (comprehensive)** | **🚀 Map Discovery + Scraping** |
| **Map + Batch** | 2-3 seconds discovery + batch time | 30,000 URLs | 98% (parallel processing) | Hybrid |

## Advanced Features

### 🏊 Browser Pool Management

DeepScraper automatically manages a pool of reusable browser instances for optimal performance:

```typescript
// Automatic browser pool management (5 browsers by default)
// No configuration needed - works automatically with streaming crawls
```

**Browser Pool Benefits**:
- **90% faster page loading** (reuse vs new browser creation: ~100ms vs 2-3 seconds)
- **Memory efficient** (controlled browser lifecycle with automatic cleanup)
- **Context isolation** (each request gets isolated browser context)
- **Automatic scaling** (pool grows/shrinks based on demand)

**Pool Statistics** (available via internal monitoring):
```json
{
  "totalBrowsers": 5,
  "activeBrowsers": 3,
  "poolUtilization": 0.6,
  "activePages": 12
}
```

### Browser Actions

Interact with dynamic content:

```json
{
  "url": "https://example.com",
  "options": {
    "actions": [
      { "type": "click", "selector": "#load-more" },
      { "type": "wait", "timeout": 2000 },
      { "type": "scroll", "position": 1000 }
    ]
  }
}
```

### Crawl Strategies

- **BFS** (default) - Breadth-first exploration
- **DFS** - Depth-first for deep content
- **Best-First** - Priority-based on content relevance

### Schema Extraction Tips

- Use clear `description` fields in your JSON Schema
- Start with simple schemas and iterate
- Lower `temperature` values for consistent results
- Include examples in descriptions for better accuracy

### Crawl File Export

Each crawled page is automatically exported as a markdown file with:

- **Filename format**: `YYYY-MM-DD_crawlId_hostname_path.md`
- **YAML frontmatter** with metadata (URL, title, crawl date, status)
- **Organized structure**: `./crawl-output/{crawl-id}/`
- **Automatic summary**: Generated when crawl completes

**Example file structure:**
```
crawl-output/
├── abc123-def456/
│   ├── 2024-01-15_abc123_docs.example.com_getting-started.md
│   ├── 2024-01-15_abc123_docs.example.com_api-reference.md
│   ├── 2024-01-15_abc123_docs.example.com_tutorials.md
│   ├── abc123-def456_summary.md
│   ├── abc123-def456_consolidated.md    # 🆕 All pages in one file
│   └── abc123-def456_consolidated.json  # 🆕 Structured JSON export
└── xyz789-ghi012/
    └── ...
```

**Consolidated Export Features:**
- **Single Markdown**: All crawled pages combined into one readable file
- **JSON Export**: Structured data with metadata for programmatic use
- **Auto-Generated**: Created automatically when crawl completes
- **Rich Metadata**: Preserves all page metadata and crawl statistics

**File content example:**
```markdown
---
url: "https://docs.example.com/getting-started"
title: "Getting Started Guide"
crawled_at: "2024-01-15T10:30:00.000Z"
status: 200
content_type: "markdown"
load_time: 1250ms
browser_mode: false
---

# Getting Started Guide

Welcome to the getting started guide...
```

## 🏗️ Architecture

```text
┌───────────────┐    REST     ┌────────────────────────┐
│    Client     │────────────▶│  Express API Gateway   │
└───────────────┘             └────────┬───────────────┘
                                        │ (Job Payload)
                                        ▼
                             ┌───────────────────────┐
                             │   BullMQ Job Queue    │ (Redis)
                             └────────┬──────────────┘
                                      │
                           pulls job   │ pushes result
                                      ▼
 ┌─────────────────┐ Playwright ┌─────────────────┐  GPT-4o ┌──────────────┐
 │ Scraper Worker  │──────────▶│  Extractor      │────────▶│ OpenAI       │
 └─────────────────┘           └─────────────────┘         └──────────────┘
   (Headless Browser)            (HTML → MD/Text/JSON)          (LLM API)
                                      │
                                      ▼
                                Cache Layer (FS/Redis)
```

## 🛣️ Roadmap

- [x] 📦 Batch processing with controlled concurrency
- [x] 📥 Multiple download formats (ZIP, JSON, individual files)
- [x] 🗺️ High-performance URL discovery (`/map` endpoint) + subdomain discovery
- [x] ✨ Fit-markdown extraction (pruning content filter)
- [x] 🎯 Deterministic CSS/selector extraction (no LLM)
- [x] 📝 Multi-format single-request responses (markdown/html/links/screenshot/…)
- [x] 🔍 Search engine API integration (`/api/search` — Serper / SearXNG / DuckDuckGo)
- [x] 📡 Live crawl streaming (SSE) + crawl ZIP/JSON downloads
- [x] 🧩 MCP server for AI agents
- [x] 📦 Node SDK
- [x] 🛡️ SSRF protection, rate limiting, per-key daily quotas
- [x] 📊 Prometheus `/metrics` + readiness probe
- [x] 🚸 Browser pool with concurrency semaphore + crash eviction
- [x] ↔️ Horizontal scaling via `ROLE=web|worker` split
- [ ] 🧠 Automatic schema generation (LLM)
- [ ] 🌐 Cloud-native cache backends (S3)
- [ ] 🌈 Web UI playground
- [ ] 📈 Batch on BullMQ + processing analytics
- [ ] 📦 Publish SDK & MCP server to npm

---


## License

Apache 2.0 - see [LICENSE](LICENSE) file

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

---


**Star ⭐ this repo if you find it useful!**
