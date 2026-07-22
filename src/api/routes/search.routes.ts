import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter } from '../middleware/rate-limit.middleware';
import { searchWeb } from '../../services/search.service';
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

      const results = await searchWeb(query, { limit, provider, lang });

      if (!scrapeResults || results.length === 0) {
        return res.json({ success: true, query, count: results.length, results });
      }

      // Scrape each result (bounded concurrency to avoid a fan-out storm).
      const scraped = await scrapeResultsBounded(results, scrapeOptions, 3);
      return res.json({ success: true, query, count: scraped.length, results: scraped });
    } catch (error) {
      logger.error(`Search error: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(500).json({ success: false, error: 'Search failed' });
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
