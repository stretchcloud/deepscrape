# DeepScrape Agent Notes

## Overview
DeepScrape is a TypeScript/Node.js web scraping service built on Express. It provides API endpoints for single-page scraping, schema-based LLM extraction, batch scraping, URL discovery (`/api/map`), and multi-page crawling with a Redis-backed BullMQ queue. Playwright is the primary scraper with an HTTP fallback, and content can be returned as HTML, Markdown, or text.

## Architecture Summary
Entry point: `src/index.ts` initializes Express, middleware, routes, and the crawl queue worker.

Scrape flow: `/api/scrape` in `src/api/routes/scraper.ts` calls `ScraperManager` in `src/scraper/scraper-manager.ts`.
Process: Playwright scrape → HTTP fallback if Playwright fails → HTML cleaning → optional Markdown/text transform → optional LLM extraction → cache write.

LLM extraction: `src/transformers/llm-extractor.ts` uses `OpenAIService` from `src/services/openai.service.ts`.
Config: `OPENAI_API_KEY`, `OPENAI_MODEL` (defaults to `gpt-4o`).

Crawl flow: `/api/crawl` in `src/api/controllers/crawler.controller.ts` uses `WebCrawler` from `src/scraper/crawler.ts`.
Queueing: jobs are managed via `src/services/queue.service.ts` using BullMQ + Redis.
Streaming discovery: `CrawlKickoffService` in `src/services/crawl-kickoff.service.ts` can run URL discovery via `URLDiscoveryService` and enqueue results as they stream in.

URL discovery: `/api/map` in `src/api/routes/map.routes.ts` uses `URLDiscoveryService` for sitemaps, robots.txt, common paths, search, and optional browser crawling.

Batch scraping: `/api/batch/scrape` in `src/api/routes/batch-scrape.routes.ts` uses `BatchScrapeService` in `src/services/batch-scrape.service.ts` with Redis persistence and optional webhooks.

## Key Data Stores
Redis: crawl metadata, job status, batch metadata, and job results.
File cache: `CacheService` stores scrape results on disk (`CACHE_DIRECTORY`).
Logs: written under `logs/` via Winston and morgan.

## Important Files
Server bootstrap: `src/index.ts`
Routes: `src/api/routes/*.ts`
Controllers: `src/api/controllers/*.ts`
Scraper: `src/scraper/*`
Transformers: `src/transformers/*`
Services: `src/services/*`
Types: `src/types/*`
Utilities: `src/utils/*`

## Environment Configuration
Required for LLM extraction: `OPENAI_API_KEY`
API security: `API_KEY` (requests use `X-API-Key` header)
Redis: `REDIS_HOST`, `REDIS_PORT`
Cache: `CACHE_ENABLED`, `CACHE_TTL`, `CACHE_DIRECTORY`
Crawler queue: `CRAWLER_CONCURRENCY`, `CRAWLER_MAX_JOBS`, `CRAWLER_LOCK_DURATION`, `CRAWLER_RETRY_ATTEMPTS`
CORS: `CORS_OPEN_MODE`, `ALLOWED_ORIGINS`, `NODE_ENV`
Browser: `PLAYWRIGHT_EXECUTABLE_PATH`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `PUPPETEER_EXECUTABLE_PATH`

## Local Dev Commands
Install deps: `npm install`
Run dev server: `npm run dev`
Build: `npm run build`
Run tests: `npm test`
Lint: `npm run lint`
Docker: `docker-compose up -d`

## Operational Notes
The crawler queue is obliterated on startup in `initQueue()`. This wipes pending jobs when the service restarts.
`/api/crawl` respects robots.txt unless `ignoreRobotsTxt` is set.
`/api/scrape` uses Playwright by default and falls back to HTTP scraping on Playwright launch errors.
If `API_KEY` is not set and `NODE_ENV=development`, auth is skipped.
Avoid committing secrets. Use `.env` or injected environment variables for all credentials.
