import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter } from '../middleware/rate-limit.middleware';
import scraperManager from '../../scraper/scraper-manager';
import { selfHealExtract, DesiredField } from '../../services/self-heal-extractor.service';
import { CssExtractionSchema } from '../../transformers/css-extractor';
import { logger } from '../../utils/logger';

const router = Router();

const fieldSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['text', 'attribute', 'html', 'number', 'list', 'nested', 'nested_list']).optional(),
  attribute: z.string().max(100).optional(),
  required: z.boolean().optional(),
});

const bodySchema = z.object({
  url: z.string().url(),
  fields: z.array(fieldSchema).min(1).max(50),
  cssSchema: z.any().optional(),      // optional bootstrap schema (skips first LLM derivation)
  forceReheal: z.boolean().optional(),
  scrapeOptions: z.record(z.any()).optional(),
});

/**
 * @route POST /api/extract-auto
 * @desc  Self-healing structured extraction. Derives CSS selectors with an LLM once,
 *        caches them, runs deterministic extraction thereafter, and re-derives when
 *        the site changes and the selectors stop yielding data.
 * @access Private (API key required)
 */
router.post('/', expensiveLimiter, apiKeyAuth, validateRequest(bodySchema), async (req: Request, res: Response) => {
  const { url, fields, cssSchema, forceReheal, scrapeOptions } = req.body as {
    url: string;
    fields: DesiredField[];
    cssSchema?: CssExtractionSchema;
    forceReheal?: boolean;
    scrapeOptions?: Record<string, any>;
  };

  try {
    // Fetch the raw (pre-clean) HTML so selectors match the real DOM.
    const scrape = await scraperManager.scrape(url, { ...(scrapeOptions ?? {}), includeRawHtml: true });
    if (scrape.error) {
      return res.status(400).json({ success: false, error: scrape.error });
    }
    const html = (scrape as { rawHtml?: string }).rawHtml
      ?? (scrape.contentType === 'html' ? scrape.content : '')
      ?? '';

    const result = await selfHealExtract({ url, html, fields, providedSchema: cssSchema, forceReheal });
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error(`extract-auto failed: ${(error as Error).message}`);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
