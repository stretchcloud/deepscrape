import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter, statusLimiter } from '../middleware/rate-limit.middleware';
import {
  createSpec,
  listSpecs,
  getSpec,
  deleteSpec,
  runSpec,
  runSpecByName,
  verifySpec,
  SpecValidationError,
  SpecNotFoundError,
} from '../../services/site-spec.service';
import { toSpecSummary } from '../../transformers/site-spec-core';
import { logger } from '../../utils/logger';
import { siteCreateSchema, siteRunSchema } from '../schemas';

const router = Router();

/** @route POST /api/sites — create a saved, self-healing extraction spec. */
router.post('/', expensiveLimiter, apiKeyAuth, validateRequest(siteCreateSchema), async (req: Request, res: Response) => {
  try {
    const { spec, sample, meta } = await createSpec(req.body);
    res.status(201).json({ success: true, spec: toSpecSummary(spec), sample, meta });
  } catch (error) {
    if (error instanceof SpecValidationError) {
      return res.status(400).json({ success: false, error: (error as Error).message });
    }
    logger.error(`Create SiteSpec failed: ${(error as Error).message}`);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** @route GET /api/sites — list spec summaries. */
router.get('/', statusLimiter, apiKeyAuth, async (_req: Request, res: Response) => {
  const specs = await listSpecs();
  res.json({ success: true, count: specs.length, sites: specs.map(toSpecSummary) });
});

/** @route POST /api/sites/by-name/:name/run — run a spec by its name (agent-friendly). */
router.post('/by-name/:name/run', expensiveLimiter, apiKeyAuth, validateRequest(siteRunSchema), async (req: Request, res: Response) => {
  try {
    const result = await runSpecByName(req.params.name, req.body?.params ?? {});
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    if (error instanceof SpecNotFoundError) {
      return res.status(404).json({ success: false, error: (error as Error).message });
    }
    throw error;
  }
});

/** @route GET /api/sites/:id — full spec (incl. derived schema). */
router.get('/:id', statusLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  const spec = await getSpec(req.params.id);
  if (!spec) return res.status(404).json({ success: false, error: 'spec not found' });
  res.json({ success: true, spec });
});

/** @route POST /api/sites/:id/run — execute the spec (with params) → fresh data. */
router.post('/:id/run', expensiveLimiter, apiKeyAuth, validateRequest(siteRunSchema), async (req: Request, res: Response) => {
  const spec = await getSpec(req.params.id);
  if (!spec) return res.status(404).json({ success: false, error: 'spec not found' });
  const result = await runSpec(spec, req.body?.params ?? {});
  res.status(result.success ? 200 : 400).json(result);
});

/** @route POST /api/sites/:id/verify — force a verify + self-heal pass. */
router.post('/:id/verify', expensiveLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  const spec = await getSpec(req.params.id);
  if (!spec) return res.status(404).json({ success: false, error: 'spec not found' });
  const result = await verifySpec(spec);
  res.json(result);
});

/** @route DELETE /api/sites/:id — remove a spec. */
router.delete('/:id', statusLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  const removed = await deleteSpec(req.params.id);
  if (!removed) return res.status(404).json({ success: false, error: 'spec not found' });
  res.json({ success: true, deleted: true });
});

export default router;
