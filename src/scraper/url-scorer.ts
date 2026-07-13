/**
 * URL scorers for best-first (guided) crawling.
 *
 * A small, self-contained port of an upstream project's URL scorers. Each scorer inspects a
 * candidate URL and returns a heuristic in the closed interval [0, 1] that a
 * best-first frontier can use to prioritise which links to visit next. Higher is
 * "more worth crawling".
 *
 * The scorers are intentionally pure and dependency-light: they take a URL string
 * (plus a little config) and return a number. Nothing here performs I/O, mutates
 * shared state, or throws on malformed input — a bad URL simply degrades to a
 * neutral/best-effort score so a crawl frontier never crashes on junk links.
 */

/** Path-depth lookup for the first few integer distances from the optimum. */
const PATH_DEPTH_LOOKUP: readonly number[] = [1.0, 0.5, 0.333, 0.25];

/** Freshness lookup for a year that is 0..5 years old. */
const FRESHNESS_LOOKUP: readonly number[] = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5];

/** Filenames that represent a directory's default document and add no real depth. */
const INDEX_FILENAMES = new Set(['index.html', 'index.php']);

/**
 * Matches a plausible 4-digit calendar year (1900-2099).
 *
 * The surrounding negative look-arounds ensure we match a standalone year and not
 * four digits carved out of a longer run (e.g. an id like "12019" must not read as
 * "2019"). Lookbehind is available on the project's ES2020 target.
 */
const YEAR_PATTERN = /(?<![0-9])(?:19|20)\d{2}(?![0-9])/;

/**
 * Best-effort extraction of a URL's path component.
 *
 * Uses the WHATWG `URL` parser for well-formed inputs and falls back to a manual
 * scheme/query/fragment strip for malformed ones, so downstream scorers never throw.
 */
function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // Malformed URL: drop "scheme://", then everything from the first "?" or "#".
    const withoutScheme = url.trim().replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    const pathAndAfter = withoutScheme.split(/[?#]/, 1)[0];
    const firstSlash = pathAndAfter.indexOf('/');
    return firstSlash >= 0 ? pathAndAfter.slice(firstSlash) : '';
  }
}

/** Clamp a raw score into the closed interval [0, 1]. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Fraction of `keywords` that appear as substrings of `url`.
 *
 * Matching is case-insensitive unless `caseSensitive` is set. An empty keyword
 * list is treated as "no preference" and returns a neutral 1.0.
 *
 * @param url           The candidate URL.
 * @param keywords      Keywords to look for anywhere in the URL string.
 * @param caseSensitive When true, compare without lower-casing. Defaults to false.
 * @returns matched / total, in [0, 1]; 1.0 when there are no keywords.
 */
export function keywordRelevanceScore(
  url: string,
  keywords: string[],
  caseSensitive = false,
): number {
  if (!keywords || keywords.length === 0) {
    return 1;
  }

  const haystack = caseSensitive ? url : url.toLowerCase();
  let matched = 0;
  for (const keyword of keywords) {
    const needle = caseSensitive ? keyword : keyword.toLowerCase();
    if (haystack.includes(needle)) {
      matched += 1;
    }
  }

  return clamp01(matched / keywords.length);
}

/**
 * Closeness of a URL's path depth to an ideal depth.
 *
 * Depth is the number of non-empty path segments, ignoring any trailing slash and
 * ignoring a trailing directory-index filename ("index.html" / "index.php"). The
 * score peaks at 1.0 when depth equals `optimalDepth` and falls off with distance:
 * the first few distances use a fixed lookup, and larger distances use 1/(1+d).
 *
 * @param url          The candidate URL.
 * @param optimalDepth Preferred number of path segments. Defaults to 3.
 * @returns A score in (0, 1]; 1.0 at the optimal depth.
 */
export function pathDepthScore(url: string, optimalDepth = 3): number {
  const pathname = getPathname(url);

  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  // A trailing directory index (index.html/index.php) does not add real depth.
  if (segments.length > 0 && INDEX_FILENAMES.has(segments[segments.length - 1].toLowerCase())) {
    segments.pop();
  }

  const depth = segments.length;
  const distance = Math.abs(depth - optimalDepth);

  const score = distance < PATH_DEPTH_LOOKUP.length
    ? PATH_DEPTH_LOOKUP[distance]
    : 1 / (1 + distance);

  return clamp01(score);
}

/**
 * Recency score derived from a 4-digit year embedded in the URL's path.
 *
 * The first standalone year (1900-2099) found in the path drives the score:
 * recent years score high, older years decay, and a future year (relative to
 * `currentYear`) is treated as maximally fresh. When no year is present the score
 * is a neutral 0.5.
 *
 * @param url         The candidate URL.
 * @param currentYear The reference "now" year to measure recency against.
 * @returns A score in [0.1, 1]; 0.5 when no year is found.
 */
export function freshnessScore(url: string, currentYear: number): number {
  const match = YEAR_PATTERN.exec(getPathname(url));
  if (!match) {
    return 0.5;
  }

  const year = parseInt(match[0], 10);
  const diff = currentYear - year;

  if (diff < 0) {
    // Year is in the future relative to "now": treat as maximally fresh.
    return 1;
  }
  if (diff < FRESHNESS_LOOKUP.length) {
    return FRESHNESS_LOOKUP[diff];
  }
  // Older than the lookup covers: linear decay with a 0.1 floor.
  return clamp01(Math.max(0.1, 1 - 0.1 * diff));
}

/** Options controlling which scorers participate in {@link compositeUrlScore}. */
export interface CompositeScorerOptions {
  /** Keywords for the keyword-relevance scorer. Omit/empty to skip it. */
  keywords?: string[];
  /** Preferred path depth for the path-depth scorer (always active). Defaults to 3. */
  optimalDepth?: number;
  /** Reference year for the freshness scorer. Omit to skip it. */
  currentYear?: number;
  /** Per-scorer weights in the weighted average. Each defaults to 1. */
  weights?: {
    keyword?: number;
    pathDepth?: number;
    freshness?: number;
  };
}

/**
 * Weighted average of the active URL scorers.
 *
 * Only scorers whose inputs are supplied participate:
 *  - keyword relevance — active when a non-empty `keywords` array is given;
 *  - path depth        — always active (uses `optimalDepth` or its default);
 *  - freshness         — active when `currentYear` is given.
 *
 * Each active scorer contributes with its weight (default 1). If the effective
 * weight total is zero (e.g. every active scorer was given weight 0), the function
 * returns a neutral 0.5 rather than dividing by zero.
 *
 * @param url  The candidate URL.
 * @param opts Which scorers to run and how to weight them.
 * @returns A weighted average in [0, 1]; 0.5 when nothing can be scored.
 */
export function compositeUrlScore(url: string, opts: CompositeScorerOptions): number {
  const weights = opts.weights ?? {};
  const keywordWeight = weights.keyword ?? 1;
  const pathDepthWeight = weights.pathDepth ?? 1;
  const freshnessWeight = weights.freshness ?? 1;

  let weightedSum = 0;
  let weightTotal = 0;

  // Keyword relevance: only meaningful when caller actually supplied keywords.
  if (opts.keywords && opts.keywords.length > 0) {
    weightedSum += keywordWeight * keywordRelevanceScore(url, opts.keywords);
    weightTotal += keywordWeight;
  }

  // Path depth is always active (has a sensible default optimum).
  weightedSum += pathDepthWeight * pathDepthScore(url, opts.optimalDepth);
  weightTotal += pathDepthWeight;

  // Freshness: only when the caller provided a reference year.
  if (typeof opts.currentYear === 'number') {
    weightedSum += freshnessWeight * freshnessScore(url, opts.currentYear);
    weightTotal += freshnessWeight;
  }

  if (weightTotal <= 0) {
    return 0.5;
  }

  return clamp01(weightedSum / weightTotal);
}
