import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter } from '../middleware/rate-limit.middleware';
import { runSearch } from '../../services/search.service';
import scraperManager from '../../scraper/scraper-manager';
import { logger } from '../../utils/logger';
import { searchRequestSchema } from '../schemas';

const router = Router();

/**
 * @route POST /api/search
 * @desc  Web search (+ optional scrape of each result).
 * @access Private (API key required)
 */
router.post(
  '/',
  expensiveLimiter,
  apiKeyAuth,
  validateRequest(searchRequestSchema),
  async (req: Request, res: Response) => {
    try {
      const { query, limit = 10, provider, lang, scrapeResults, scrapeOptions } = req.body;
      logger.info(`Search request: "${query}" (limit ${limit}, provider ${provider ?? 'default'})`);

      const { results, provider: usedProvider, reason } = await runSearch(query, { limit, provider, lang });

      if (!scrapeResults || results.length === 0) {
        // `note` explains an empty result set (e.g. keyless provider blocked) so a
        // zero-count response is never a silent mystery.
        return res.json({
          success: true, query, provider: usedProvider, count: results.length, results,
          ...(reason ? { note: reason } : {}),
        });
      }

      // Scrape each result (bounded concurrency to avoid a fan-out storm).
      const scraped = await scrapeResultsBounded(results, scrapeOptions, 3);
      return res.json({ success: true, query, provider: usedProvider, count: scraped.length, results: scraped });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Search error: ${msg}`);
      // Missing provider config (SEARXNG_URL / SERPER_API_KEY) is the caller's to fix —
      // surface the actionable message as a 400 instead of an opaque 500.
      const isConfigError = /SEARXNG_URL|SERPER_API_KEY/.test(msg);
      return res.status(isConfigError ? 400 : 500).json({
        success: false,
        error: isConfigError ? msg : 'Search failed',
      });
    }
  }
);

async function scrapeResultsBounded(
  results: Array<{ title: string; url: string; snippet: string; position: number }>,
  scrapeOptions: Record<string, any> | undefined,
  concurrency: number
): Promise<any[]> {
  const out: any[] = new Array(results.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, results.length) }, async () => {
    while (cursor < results.length) {
      const i = cursor++;
      const r = results[i];
      try {
        const scrape = await scraperManager.scrape(r.url, {
          extractorFormat: 'markdown',
          preferHttpScraper: true,
          ...(scrapeOptions || {})
        });
        out[i] = { ...r, markdown: scrape.error ? undefined : scrape.content, scrapeError: scrape.error };
      } catch (err) {
        out[i] = { ...r, scrapeError: (err as Error).message };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export default router;
