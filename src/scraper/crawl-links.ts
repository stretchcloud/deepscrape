import { load } from 'cheerio';
import { logger } from '../utils/logger';

/**
 * Link discovery + filtering for recursive crawling.
 *
 * Kept deliberately small and self-contained (independent of the legacy
 * WebCrawler's tangled filter chain) so the recursive page-crawl path has clear,
 * correct semantics: resolve → same-domain → include/exclude → not-a-binary-file.
 * Deduplication and the global page budget are handled by the caller via Redis.
 */

export interface ChildLinkOptions {
  seedUrl: string;
  allowSubdomains?: boolean;
  allowExternalLinks?: boolean;
  includePaths?: string[];
  excludePaths?: string[];
  regexOnFullURL?: boolean;
}

// Binary / non-HTML extensions we should never enqueue as crawlable pages.
const NON_PAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
  'css', 'js', 'mjs', 'map', 'json', 'xml', 'rss', 'atom',
  'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'dmg', 'exe', 'bin',
  'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ogg', 'wav',
  'woff', 'woff2', 'ttf', 'eot', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
]);

/** Extract absolute http(s) links from a page's HTML, resolving relatives. */
export function extractChildLinks(html: string, pageUrl: string): string[] {
  if (!html) return [];
  const links = new Set<string>();
  try {
    const $ = load(html);
    // Honor a <base href> if present.
    const baseHref = $('base[href]').attr('href');
    let base = pageUrl;
    if (baseHref) {
      try { base = new URL(baseHref, pageUrl).href; } catch { /* keep pageUrl */ }
    }
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const abs = new URL(href, base);
        if (abs.protocol === 'http:' || abs.protocol === 'https:') {
          abs.hash = '';
          links.add(abs.href);
        }
      } catch {
        /* skip malformed href */
      }
    });
  } catch (err) {
    logger.debug(`extractChildLinks failed for ${pageUrl}: ${(err as Error).message}`);
  }
  return [...links];
}

function hostMatches(linkHost: string, seedHost: string, allowSubdomains: boolean): boolean {
  const l = linkHost.replace(/^www\./, '').toLowerCase();
  const s = seedHost.replace(/^www\./, '').toLowerCase();
  if (l === s) return true;
  if (allowSubdomains) {
    return l.endsWith('.' + s);
  }
  return false;
}

function extensionOf(pathname: string): string {
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot >= 0 ? last.slice(dot + 1).toLowerCase() : '';
}

/** Compile a user pattern to a RegExp safely; returns null if it doesn't compile. */
function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * Filter candidate links to those that should be crawled next. Same-domain by
 * default, honoring include/exclude patterns and skipping binary assets.
 */
export function filterChildLinks(links: string[], opts: ChildLinkOptions): string[] {
  let seedHost: string;
  try {
    seedHost = new URL(opts.seedUrl).hostname;
  } catch {
    return [];
  }

  const includeRes = (opts.includePaths ?? []).map(safeRegex).filter(Boolean) as RegExp[];
  const excludeRes = (opts.excludePaths ?? []).map(safeRegex).filter(Boolean) as RegExp[];

  const out: string[] = [];
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      continue;
    }

    // Domain policy.
    if (!opts.allowExternalLinks && !hostMatches(u.hostname, seedHost, opts.allowSubdomains ?? false)) {
      continue;
    }

    // Skip binary/asset files.
    if (NON_PAGE_EXTENSIONS.has(extensionOf(u.pathname))) {
      continue;
    }

    const target = opts.regexOnFullURL ? u.href : u.pathname;

    // Exclude wins over include.
    if (excludeRes.length > 0 && excludeRes.some(re => re.test(target))) {
      continue;
    }
    if (includeRes.length > 0 && !includeRes.some(re => re.test(target))) {
      continue;
    }

    out.push(link);
  }
  return out;
}
