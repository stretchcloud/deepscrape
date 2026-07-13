import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { logger } from '../../utils/logger';

/**
 * Parse configured API keys. Supports a comma-separated list in API_KEY so keys
 * can be rotated without downtime (old + new valid simultaneously).
 */
function getConfiguredKeys(): string[] {
  return (process.env.API_KEY ?? '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
}

/** SHA-256 digest so timingSafeEqual always compares equal-length buffers. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Constant-time check of a presented key against the configured set.
 */
function isValidKey(presented: string, configured: string[]): boolean {
  const presentedDigest = digest(presented);
  let match = false;
  for (const key of configured) {
    // timingSafeEqual over fixed-length hashes — no early exit, no length leak.
    if (timingSafeEqual(presentedDigest, digest(key))) {
      match = true;
    }
  }
  return match;
}

/**
 * API key authentication middleware.
 *
 * - Keys are accepted ONLY via the `X-API-Key` header (never the query string,
 *   which would leak them into access logs, proxies, and browser history).
 * - Comparison is constant-time and the presented key is never logged.
 * - Fails closed: if no API_KEY is configured the request is rejected, unless
 *   DISABLE_AUTH=true is explicitly set (intended for local development only and
 *   refused when NODE_ENV=production — see assertAuthConfigured()).
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.DISABLE_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
      return next();
    }

    const configuredKeys = getConfiguredKeys();
    if (configuredKeys.length === 0) {
      logger.error('No API_KEY configured — rejecting request (set API_KEY or DISABLE_AUTH=true for local dev)');
      return res.status(503).json({
        success: false,
        error: 'Service not configured for authentication'
      });
    }

    const headerValue = req.headers['x-api-key'];
    const presented = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!presented || !isValidKey(presented, configuredKeys)) {
      // Never log the presented value.
      logger.warn(`Rejected request with invalid/missing API key from ${req.ip}`);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: invalid or missing API key'
      });
    }

    return next();
  } catch (error) {
    logger.error(`Error in auth middleware: ${error instanceof Error ? error.message : String(error)}`);
    return res.status(500).json({
      success: false,
      error: 'Server error during authentication'
    });
  }
};

/**
 * Startup guard. Refuses to run a production process with authentication
 * effectively disabled. Call once during boot.
 */
export function assertAuthConfigured(): void {
  const keys = getConfiguredKeys();
  const disabled = process.env.DISABLE_AUTH === 'true';

  if (process.env.NODE_ENV === 'production') {
    if (disabled) {
      throw new Error('DISABLE_AUTH=true is not permitted when NODE_ENV=production');
    }
    if (keys.length === 0) {
      throw new Error('API_KEY must be set in production');
    }
    const weak = keys.filter(k => k.length < 16 || ['test-key', 'changeme', 'your-secret-key'].includes(k));
    if (weak.length > 0) {
      throw new Error('API_KEY is too weak or uses a known placeholder — set a strong random key (>=16 chars)');
    }
  } else if (keys.length === 0 && !disabled) {
    logger.warn('No API_KEY set. All authenticated endpoints will return 503 until API_KEY is configured (or set DISABLE_AUTH=true for local dev).');
  }
}
