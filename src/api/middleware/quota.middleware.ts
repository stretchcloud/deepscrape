import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../../services/redis.service';
import { logger } from '../../utils/logger';

/**
 * Per-API-key daily quota. Complements rate limiting (which bounds burst rate)
 * by bounding total daily usage per key — the basic building block of
 * multi-tenant fairness. Backed by a Redis counter that resets each UTC day.
 *
 * Configure with DAILY_QUOTA (requests/key/day). 0 or unset = unlimited (off).
 * Per-key overrides via DAILY_QUOTA_OVERRIDES="key1:5000,key2:100000".
 */

function parseOverrides(): Record<string, number> {
  const raw = process.env.DAILY_QUOTA_OVERRIDES ?? '';
  const map: Record<string, number> = {};
  for (const pair of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const idx = pair.lastIndexOf(':');
    if (idx > 0) {
      const key = pair.slice(0, idx);
      const val = Number(pair.slice(idx + 1));
      if (Number.isFinite(val)) map[key] = val;
    }
  }
  return map;
}

const overrides = parseOverrides();

function limitFor(apiKey: string): number {
  if (overrides[apiKey] !== undefined) return overrides[apiKey];
  return Number(process.env.DAILY_QUOTA ?? 0);
}

function todayUtc(): string {
  // YYYY-MM-DD in UTC without Date parsing pitfalls.
  return new Date().toISOString().slice(0, 10);
}

export async function dailyQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const headerKey = req.headers['x-api-key'];
    const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;

    // No key (e.g. DISABLE_AUTH dev mode) or quota disabled -> allow.
    if (!apiKey) return next();
    const limit = limitFor(apiKey);
    if (!limit || limit <= 0) return next();

    const bucket = `quota:${apiKey}:${todayUtc()}`;
    const used = await redisClient.incr(bucket);
    if (used === 1) {
      // First hit of the day — expire the counter at ~48h so it self-cleans.
      await redisClient.expire(bucket, 48 * 60 * 60);
    }

    res.setHeader('X-Quota-Limit', String(limit));
    res.setHeader('X-Quota-Remaining', String(Math.max(0, limit - used)));

    if (used > limit) {
      logger.warn(`Daily quota exceeded for key ${apiKey.slice(0, 6)}… (${used}/${limit})`);
      res.status(429).json({ success: false, error: 'Daily quota exceeded' });
      return;
    }
    return next();
  } catch (err) {
    // Fail open on Redis hiccups — quota is a fairness control, not a security gate.
    logger.error(`Quota check failed (allowing request): ${(err as Error).message}`);
    return next();
  }
}
