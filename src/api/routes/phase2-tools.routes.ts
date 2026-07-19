import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter, statusLimiter } from '../middleware/rate-limit.middleware';
import scraperManager from '../../scraper/scraper-manager';
import { discoverApis } from '../../services/api-discovery.service';
import { logger } from '../../utils/logger';

// ---- POST /api/discover-apis : surface a page's underlying JSON/XHR endpoints ----
export const discoverApisRouter = Router();
const discoverSchema = z.object({
  url: z.string().url(),
  timeout: z.number().int().min(1000).max(120000).optional(),
  includeNonJson: z.boolean().optional(),
});
discoverApisRouter.post('/', expensiveLimiter, apiKeyAuth, validateRequest(discoverSchema), async (req: Request, res: Response) => {
  try {
    const { url, timeout, includeNonJson } = req.body;
    const result = await discoverApis(url, { timeout, includeNonJson });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error(`discover-apis failed: ${(error as Error).message}`);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// ---- GET /api/reader?url=... : scrape to markdown, honoring Accept: text/markdown ----
export const readerRouter = Router();
readerRouter.get('/', expensiveLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  const url = String(req.query.url ?? '');
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return res.status(400).json({ success: false, error: 'valid `url` query parameter required' });
  }
  try {
    const scrape = await scraperManager.scrape(url, { extractorFormat: 'markdown', onlyMainContent: true });
    if (scrape.error) return res.status(400).json({ success: false, error: scrape.error });
    const markdown = scrape.content ?? '';

    // Content negotiation: AI agents increasingly request `Accept: text/markdown`.
    const accept = String(req.headers.accept ?? '');
    if (accept.includes('text/markdown') || accept.includes('text/plain')) {
      res.type('text/markdown; charset=utf-8').send(markdown);
      return;
    }
    res.json({ success: true, url, title: scrape.title, markdown });
  } catch (error) {
    logger.error(`reader failed: ${(error as Error).message}`);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ---- POST /api/crawl/estimate : pre-run cost/size estimate ----
export const crawlEstimateRouter = Router();
const estimateSchema = z.object({
  url: z.string().url().optional(),
  limit: z.number().int().positive().optional(),
  maxDepth: z.number().int().min(0).optional(),
  scrapeOptions: z.record(z.any()).optional(),
});
crawlEstimateRouter.post('/', statusLimiter, apiKeyAuth, validateRequest(estimateSchema), (req: Request, res: Response) => {
  const { limit, scrapeOptions } = req.body as { limit?: number; scrapeOptions?: Record<string, any> };
  const maxLimit = Number(process.env.MAX_CRAWL_LIMIT ?? 1000);
  const maxPages = Math.min(limit ?? 100, maxLimit);
  const usesBrowser = scrapeOptions?.useBrowser === true;
  // LLM is only used when extraction is requested WITHOUT a deterministic cssSchema.
  const usesLlm = Boolean(scrapeOptions?.extractionOptions && !scrapeOptions?.extractionOptions?.cssSchema);
  res.json({
    success: true,
    estimate: {
      maxPages,
      renderMode: usesBrowser ? 'browser' : 'http',
      estimatedLlmCalls: usesLlm ? maxPages : 0,
      pricing: 'self-hosted: flat infrastructure cost — no per-page or per-result fees.',
      note: usesLlm
        ? 'LLM extraction uses YOUR OpenAI key (no markup). Set a cssSchema or /api/extract-auto to avoid per-page LLM cost.'
        : 'No LLM calls: extraction is deterministic or disabled. Cost is compute/proxy only, capped by `limit`.',
    },
  });
});
