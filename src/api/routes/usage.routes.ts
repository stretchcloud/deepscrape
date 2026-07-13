import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { redisClient } from '../../services/redis.service';
import { logger } from '../../utils/logger';

const router = Router();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyLimitFor(apiKey: string): number {
  const overrides = (process.env.DAILY_QUOTA_OVERRIDES ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .reduce<Record<string, number>>((m, pair) => {
      const idx = pair.lastIndexOf(':');
      if (idx > 0) { const v = Number(pair.slice(idx + 1)); if (Number.isFinite(v)) m[pair.slice(0, idx)] = v; }
      return m;
    }, {});
  if (overrides[apiKey] !== undefined) return overrides[apiKey];
  return Number(process.env.DAILY_QUOTA ?? 0);
}

/**
 * @route GET /api/usage
 * @desc  Report the calling key's daily usage vs quota (introspection).
 * @access Private (API key required)
 */
router.get('/', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const headerKey = req.headers['x-api-key'];
    const apiKey = (Array.isArray(headerKey) ? headerKey[0] : headerKey) ?? '';
    const day = todayUtc();
    const used = Number((await redisClient.get(`quota:${apiKey}:${day}`)) ?? 0);
    const limit = dailyLimitFor(apiKey);

    res.status(200).json({
      success: true,
      date: day,
      usage: {
        requestsToday: used,
        dailyLimit: limit > 0 ? limit : null,
        remaining: limit > 0 ? Math.max(0, limit - used) : null,
        unlimited: limit <= 0
      }
    });
  } catch (error) {
    logger.error(`Usage lookup failed: ${(error as Error).message}`);
    res.status(500).json({ success: false, error: 'Failed to read usage' });
  }
});

export default router;
