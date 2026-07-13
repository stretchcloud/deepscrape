import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Request } from 'express';
import { createRedisClient } from '../../services/redis-connection';
import { logger } from '../../utils/logger';

/**
 * Rate limiting for a public, browser-spawning API.
 *
 * Every scrape/crawl can launch headless Chromium and call an LLM, so unbounded
 * request rates are a direct cost/DoS amplifier. Limits are keyed by API key
 * (falling back to client IP) and, when Redis is available, shared across
 * instances via a Redis store so horizontal scaling doesn't multiply the limit.
 */

// One Redis client shared by all limiter stores (unless disabled → in-memory).
let sendCommand: ((...args: string[]) => Promise<never>) | undefined;
if (process.env.RATE_LIMIT_DISABLE !== 'true') {
  try {
    const client = createRedisClient('rate-limit');
    sendCommand = (...args: string[]) =>
      (client as unknown as { call: (...a: string[]) => Promise<never> }).call(...args);
  } catch (err) {
    logger.warn(`Rate limiter falling back to in-memory store: ${(err as Error).message}`);
  }
}

/** Identify the caller by API key (preferred) or source IP. */
function keyGenerator(req: Request): string {
  const headerValue = req.headers['x-api-key'];
  const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return key ? `k:${key}` : `ip:${req.ip}`;
}

function buildLimiter(name: string, windowMs: number, max: number): RateLimitRequestHandler {
  const options: Partial<Options> = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      logger.warn(`Rate limit exceeded [${name}] for ${keyGenerator(req)}`);
      res.status(429).json({
        success: false,
        error: 'Too many requests — slow down and retry later'
      });
    }
  };
  if (sendCommand) {
    // Each limiter gets its own key namespace within the shared Redis store.
    options.store = new RedisStore({ sendCommand, prefix: `rl:${name}:` });
  }
  return rateLimit(options);
}

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);

/** Generous global limit applied to all /api traffic (catches abusive bursts). */
export const globalLimiter = buildLimiter('global', WINDOW_MS, Number(process.env.RATE_LIMIT_GLOBAL ?? 120));

/** Strict limit for expensive, browser/LLM-spawning endpoints. */
export const expensiveLimiter = buildLimiter('expensive', WINDOW_MS, Number(process.env.RATE_LIMIT_EXPENSIVE ?? 20));

/** Very strict limit for crawl kickoff (one request fans out to many fetches). */
export const crawlLimiter = buildLimiter('crawl', WINDOW_MS, Number(process.env.RATE_LIMIT_CRAWL ?? 10));

/** Looser limit for cheap status/polling endpoints. */
export const statusLimiter = buildLimiter('status', WINDOW_MS, Number(process.env.RATE_LIMIT_STATUS ?? 600));
