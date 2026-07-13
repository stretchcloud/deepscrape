import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';

/**
 * Self-contained, pluggable web-search service.
 *
 * Two providers are supported, neither of which needs an SDK or extra dependency:
 *
 *  - `duckduckgo` (default): scrapes DuckDuckGo's keyless HTML endpoint
 *    (`https://html.duckduckgo.com/html/`) and parses the returned markup with
 *    cheerio. DuckDuckGo wraps every organic result URL in a `/l/?uddg=<real-url>`
 *    redirect, which we decode back to the real destination.
 *  - `searxng`: queries a self-hosted SearXNG instance's JSON API. The instance
 *    base URL is read from the `SEARXNG_URL` environment variable.
 *
 * The public surface is intentionally tiny — a single {@link searchWeb} entry point
 * plus the plain data shapes it returns. The HTML parsing is additionally exposed as
 * {@link parseDuckDuckGoHtml} so it can be unit-tested against fixtures without any
 * network access.
 *
 * Robustness is a first-class concern: providers never throw on empty or malformed
 * responses. They log a warning and return an empty array instead. The only case that
 * intentionally throws is selecting the `searxng` provider without configuring
 * `SEARXNG_URL`, which is a caller/config error rather than a runtime search failure.
 */

/** A single organic search result. */
export interface SearchResult {
  /** Human-readable result title. */
  title: string;
  /** Fully-resolved destination URL (redirect wrappers already decoded). */
  url: string;
  /** Short descriptive snippet / excerpt for the result. */
  snippet: string;
  /** 1-based rank of the result within the returned list. */
  position: number;
}

/** Options controlling a {@link searchWeb} call. */
export interface SearchOptions {
  /** Maximum number of results to return (default {@link DEFAULT_LIMIT}). */
  limit?: number;
  /** Which search backend to use. Default: auto (serper if SERPER_API_KEY, else searxng if SEARXNG_URL, else duckduckgo). */
  provider?: 'duckduckgo' | 'searxng' | 'serper';
  /**
   * Preferred result language/region. Mapped to DuckDuckGo's `kl` region param
   * (e.g. `us-en`) and to SearXNG's `language` param (e.g. `en`).
   */
  lang?: string;
}

/** Default number of results returned when `limit` is not supplied. */
const DEFAULT_LIMIT = 10;

/** Per-request network timeout, in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

/** DuckDuckGo's keyless HTML search endpoint. */
const DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';

/** Realistic desktop browser User-Agent so endpoints serve the standard markup. */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Run a web search and return normalised, deduplicated results.
 *
 * @param query Free-text search query.
 * @param opts  Provider / limit / language options — see {@link SearchOptions}.
 * @returns Up to `opts.limit` results, deduplicated by URL with contiguous 1-based
 *          `position` values. Returns `[]` for an empty query or on any provider
 *          request failure.
 * @throws  When `opts.provider === 'searxng'` but `SEARXNG_URL` is not configured.
 */
export async function searchWeb(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  // Auto-select the most reliable configured provider when none is specified:
  // Serper (keyed) > SearXNG (self-hosted) > DuckDuckGo (keyless, best-effort —
  // datacenter IPs are frequently anti-bot challenged, so keyless is not reliable
  // for production; configure SERPER_API_KEY or SEARXNG_URL for dependable results).
  const provider = opts.provider ?? autoProvider();
  const limit = normalizeLimit(opts.limit);

  const trimmedQuery = (query ?? '').trim();
  if (!trimmedQuery) {
    logger.warn('searchWeb called with an empty query; returning no results', { provider });
    return [];
  }

  let results: SearchResult[];
  switch (provider) {
    case 'serper':
      results = await fetchSerper(trimmedQuery, limit, opts);
      break;
    case 'searxng':
      // NOTE: a missing SEARXNG_URL throws (config error); request failures do not.
      results = await fetchSearxng(trimmedQuery, limit, opts);
      break;
    case 'duckduckgo':
    default:
      results = await fetchDuckDuckGo(trimmedQuery, limit, opts);
      break;
  }

  // Final safety net so the public contract (dedup + cap + contiguous positions)
  // always holds, independent of any individual provider's implementation.
  return dedupeAndCap(results, limit);
}

/**
 * Parse a DuckDuckGo HTML search-results page into structured results.
 *
 * Exposed separately from the network layer so it can be exercised directly with
 * fixture strings. It never throws: empty, malformed, or unexpected markup yields an
 * empty array (with a logged warning) rather than an exception.
 *
 * @param html  Raw HTML returned by the DuckDuckGo HTML endpoint.
 * @param limit Maximum number of results to return.
 * @returns Deduplicated results (by resolved URL), capped at `limit`, with 1-based
 *          `position`. Ad / redirect-only entries (no decodable destination) are skipped.
 */
export function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (!html || max <= 0) {
    if (!html) {
      logger.warn('parseDuckDuckGoHtml received empty HTML; returning no results');
    }
    return [];
  }

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch (error) {
    // cheerio is extremely tolerant, but treat any parse failure as "no results".
    logger.warn('Failed to parse DuckDuckGo HTML; returning no results', {
      error: (error as Error).message,
    });
    return [];
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // Iterate the result anchors directly (`a.result__a`) rather than a container
  // class — DuckDuckGo periodically changes the wrapper class, but the result
  // link anchor has been stable. Ads link to `//duckduckgo.com/y.js?...` with no
  // `uddg` param and are dropped by the URL resolver.
  const $anchors = $('a.result__a');
  if ($anchors.length === 0) {
    logger.warn('DuckDuckGo HTML contained no result anchors; markup may have changed');
    return [];
  }

  $anchors.each((_index, element) => {
    if (results.length >= max) {
      return false; // reached the cap — stop iterating
    }

    const $anchor = $(element);
    const url = resolveDuckDuckGoUrl($anchor.attr('href') ?? '');
    if (!url || seen.has(url)) {
      return; // ad / redirect-only / duplicate — skip
    }

    // The snippet lives in the nearest result container; find it robustly by
    // walking up to an ancestor that holds a `.result__snippet`.
    const $container = $anchor.closest('.result, .web-result, .results_links, .results_links_deep, .links_main, .result__body');
    let snippet = $container.find('.result__snippet').first().text().trim();
    if (!snippet) {
      snippet = $anchor.parent().parent().find('.result__snippet').first().text().trim();
    }

    seen.add(url);
    results.push({
      title: $anchor.text().trim(),
      url,
      snippet,
      position: results.length + 1,
    });

    return;
  });

  return results;
}

/**
 * Resolve a DuckDuckGo result href into its real destination URL.
 *
 * DuckDuckGo wraps organic results in a redirect of the form
 * `//duckduckgo.com/l/?uddg=<url-encoded-real-url>&rut=...`; the real URL lives in
 * the `uddg` query parameter. Direct `https://` hrefs are returned unchanged. Any
 * `duckduckgo.com` link *without* a `uddg` param is an ad/tracker and yields `null`.
 *
 * @param href Raw `href` attribute value (may be protocol-relative or root-relative).
 * @returns The real destination URL, or `null` when there is nothing to link to.
 */
function resolveDuckDuckGoUrl(href: string): string | null {
  const raw = (href ?? '').trim();
  if (!raw) {
    return null;
  }

  // Resolve against the DuckDuckGo origin so protocol-relative (`//host/...`) and
  // root-relative (`/l/?...`) hrefs parse uniformly; absolute hrefs keep their origin.
  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://duckduckgo.com');
  } catch {
    return null;
  }

  // `URLSearchParams.get` returns the already-decoded value of the redirect target.
  const uddg = parsed.searchParams.get('uddg');
  if (uddg) {
    return uddg;
  }

  // A duckduckgo.com link with no `uddg` is an ad / redirect stub — nothing to link to.
  if (parsed.hostname === 'duckduckgo.com' || parsed.hostname.endsWith('.duckduckgo.com')) {
    return null;
  }

  // Otherwise it is already a direct result link.
  return parsed.toString();
}

/**
 * Fetch and parse results from the keyless DuckDuckGo HTML endpoint.
 * Never throws — network / HTTP failures are logged and yield `[]`.
 */
async function fetchDuckDuckGo(query: string, limit: number, opts: SearchOptions): Promise<SearchResult[]> {
  const form = new URLSearchParams({ q: query });
  if (opts.lang) {
    // DuckDuckGo uses `kl` for region/locale, e.g. `us-en`.
    form.set('kl', opts.lang);
  }

  try {
    // The HTML endpoint expects a POST form submission; a GET returns a 202
    // challenge page with no results. Note: DuckDuckGo still anti-bot-challenges
    // datacenter IPs, so this keyless path is best-effort — configure SERPER_API_KEY
    // or SEARXNG_URL for reliable search.
    const response = await axios.post<string>(DUCKDUCKGO_HTML_ENDPOINT, form.toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      headers: {
        'User-Agent': DESKTOP_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': opts.lang ? opts.lang : 'en-US,en;q=0.9',
      },
    });

    if (response.status === 202) {
      logger.warn('DuckDuckGo returned a 202 challenge (anti-bot); no results. Configure SERPER_API_KEY or SEARXNG_URL for reliable search.');
      return [];
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    return parseDuckDuckGoHtml(html, limit);
  } catch (error) {
    logger.warn('DuckDuckGo search request failed', {
      query,
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Fetch and map results from a self-hosted SearXNG instance's JSON API.
 *
 * @throws When `SEARXNG_URL` is not set (config error). Request/parse failures are
 *         logged and yield `[]` instead of throwing.
 */
/** Pick the most reliable configured provider when the caller didn't specify one. */
function autoProvider(): 'serper' | 'searxng' | 'duckduckgo' {
  if (process.env.SERPER_API_KEY && process.env.SERPER_API_KEY.trim()) return 'serper';
  if (process.env.SEARXNG_URL && process.env.SEARXNG_URL.trim()) return 'searxng';
  return 'duckduckgo';
}

/**
 * Serper.dev — a reliable, keyed Google-search API (free tier available). Set
 * SERPER_API_KEY. POST https://google.serper.dev/search with {q, num}.
 */
async function fetchSerper(query: string, limit: number, opts: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('searchWeb: provider \'serper\' selected but SERPER_API_KEY is not set.');
  }
  try {
    const body: Record<string, unknown> = { q: query, num: Math.min(limit, 100) };
    if (opts.lang) body.gl = opts.lang;
    const response = await axios.post('https://google.serper.dev/search', body, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'X-API-KEY': apiKey.trim(), 'Content-Type': 'application/json' },
    });
    const organic = (response.data as { organic?: unknown }).organic;
    if (!Array.isArray(organic)) {
      logger.warn('Serper response had no organic results array');
      return [];
    }
    const results: SearchResult[] = [];
    for (const r of organic) {
      const item = r as { title?: string; link?: string; snippet?: string };
      if (typeof item.link !== 'string') continue;
      results.push({
        title: (item.title ?? '').trim(),
        url: item.link,
        snippet: (item.snippet ?? '').trim(),
        position: results.length + 1,
      });
      if (results.length >= limit) break;
    }
    return results;
  } catch (error) {
    logger.warn('Serper search request failed', { query, error: (error as Error).message });
    return [];
  }
}

async function fetchSearxng(query: string, limit: number, opts: SearchOptions): Promise<SearchResult[]> {
  const base = process.env.SEARXNG_URL;
  if (!base || !base.trim()) {
    throw new Error(
      'searchWeb: provider \'searxng\' selected but the SEARXNG_URL environment variable is not set. ' +
        'Set SEARXNG_URL to your SearXNG instance base URL (e.g. https://searx.example.com).'
    );
  }

  const endpoint = `${base.trim().replace(/\/+$/, '')}/search`;
  const params = new URLSearchParams({ q: query, format: 'json' });
  if (opts.lang) {
    params.set('language', opts.lang);
  }

  try {
    const response = await axios.get(endpoint, {
      params,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'User-Agent': DESKTOP_USER_AGENT,
        Accept: 'application/json',
      },
    });

    return mapSearxngResults(response.data, limit);
  } catch (error) {
    logger.warn('SearXNG search request failed', {
      endpoint,
      query,
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Map a raw SearXNG JSON response (`{ results: [...] }`) into {@link SearchResult}s,
 * deduplicated by URL and capped at `limit`. Tolerant of missing/oddly-typed fields.
 */
function mapSearxngResults(data: unknown, limit: number): SearchResult[] {
  const rawResults = extractSearxngResultArray(data);
  if (!rawResults) {
    logger.warn('SearXNG response did not contain a results array; returning no results');
    return [];
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const entry of rawResults) {
    if (results.length >= limit) {
      break;
    }
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      title: typeof record.title === 'string' ? record.title.trim() : '',
      url,
      snippet: typeof record.content === 'string' ? record.content.trim() : '',
      position: results.length + 1,
    });
  }

  return results;
}

/** Safely pull the `results` array out of an unknown SearXNG JSON payload. */
function extractSearxngResultArray(data: unknown): unknown[] | null {
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) {
      return results;
    }
  }
  return null;
}

/**
 * Deduplicate results by URL (preserving order), cap at `limit`, and re-number
 * `position` as a contiguous 1-based sequence.
 */
function dedupeAndCap(results: SearchResult[], limit: number): SearchResult[] {
  const deduped: SearchResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (deduped.length >= limit) {
      break;
    }
    if (seen.has(result.url)) {
      continue;
    }
    seen.add(result.url);
    deduped.push({ ...result, position: deduped.length + 1 });
  }

  return deduped;
}

/**
 * Normalise a user-supplied limit into a non-negative integer, falling back to
 * {@link DEFAULT_LIMIT} when it is omitted or not a finite number.
 */
function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  const floored = Math.floor(limit);
  return floored > 0 ? floored : 0;
}
