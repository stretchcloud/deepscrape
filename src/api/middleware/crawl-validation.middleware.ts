import { Request, Response, NextFunction } from 'express';

/**
 * Validate and clamp crawl parameters. `/api/crawl` previously accepted raw,
 * unbounded values (limit, maxDepth, concurrency, pattern arrays) straight from
 * the request body — a single request could ask for millions of pages or huge
 * concurrency and exhaust memory. This middleware enforces hard ceilings and
 * rejects malformed/uncompilable pattern regexes (ReDoS surface).
 */

const MAX_CRAWL_LIMIT = Number(process.env.MAX_CRAWL_LIMIT ?? 1000);
const MAX_CRAWL_DEPTH = Number(process.env.MAX_CRAWL_DEPTH ?? 10);
const MAX_CONCURRENCY = Number(process.env.MAX_CRAWL_CONCURRENCY ?? 10);
const MAX_PATTERNS = 25;
const MAX_PATTERN_LEN = 200;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/** Validate a user-supplied pattern list: array, bounded count/length, compiles. */
function validatePatterns(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return `${field} must be an array of strings`;
  if (value.length > MAX_PATTERNS) return `${field} may contain at most ${MAX_PATTERNS} patterns`;
  for (const p of value) {
    if (typeof p !== 'string') return `${field} entries must be strings`;
    if (p.length > MAX_PATTERN_LEN) return `${field} pattern exceeds ${MAX_PATTERN_LEN} chars`;
    try {
      // Reject patterns that don't compile so a bad regex can't crash a worker.
      // eslint-disable-next-line no-new
      new RegExp(p);
    } catch {
      return `${field} contains an invalid regular expression: ${p.slice(0, 40)}`;
    }
  }
  return null;
}

export function validateCrawlRequest(req: Request, res: Response, next: NextFunction): void {
  const body = req.body ?? {};

  // URL is required and must be http(s).
  if (!body.url || typeof body.url !== 'string') {
    res.status(400).json({ success: false, error: 'A "url" string is required' });
    return;
  }
  try {
    const parsed = new URL(body.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      res.status(400).json({ success: false, error: 'url must use http or https' });
      return;
    }
  } catch {
    res.status(400).json({ success: false, error: 'url is not a valid URL' });
    return;
  }

  // Validate pattern arrays wherever they can appear.
  for (const field of ['includePaths', 'excludePaths', 'includePatterns', 'excludePatterns']) {
    const err = validatePatterns(body[field], field);
    if (err) {
      res.status(400).json({ success: false, error: err });
      return;
    }
  }

  // Validate webhook URL if provided.
  if (body.webhook !== undefined) {
    if (typeof body.webhook !== 'string') {
      res.status(400).json({ success: false, error: 'webhook must be a URL string' });
      return;
    }
    try {
      const wh = new URL(body.webhook);
      if (!['http:', 'https:'].includes(wh.protocol)) {
        res.status(400).json({ success: false, error: 'webhook must use http or https' });
        return;
      }
    } catch {
      res.status(400).json({ success: false, error: 'webhook is not a valid URL' });
      return;
    }
  }

  // Clamp numeric limits in place so downstream code sees safe values.
  if (body.limit !== undefined) body.limit = clamp(body.limit, 1, MAX_CRAWL_LIMIT, MAX_CRAWL_LIMIT);
  if (body.maxUrls !== undefined) body.maxUrls = clamp(body.maxUrls, 1, MAX_CRAWL_LIMIT, MAX_CRAWL_LIMIT);
  if (body.maxDepth !== undefined) body.maxDepth = clamp(body.maxDepth, 0, MAX_CRAWL_DEPTH, MAX_CRAWL_DEPTH);
  if (body.maxDiscoveryDepth !== undefined) body.maxDiscoveryDepth = clamp(body.maxDiscoveryDepth, 0, MAX_CRAWL_DEPTH, MAX_CRAWL_DEPTH);

  if (body.crawlOptions && typeof body.crawlOptions === 'object') {
    const co = body.crawlOptions;
    if (co.maxConcurrentCrawlers !== undefined) co.maxConcurrentCrawlers = clamp(co.maxConcurrentCrawlers, 1, MAX_CONCURRENCY, 2);
    if (co.browserPoolSize !== undefined) co.browserPoolSize = clamp(co.browserPoolSize, 1, MAX_CONCURRENCY, 2);
  }

  next();
}
