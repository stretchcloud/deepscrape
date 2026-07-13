import { BrowserPoolService } from './browser-pool.service';
import { assertPublicUrl, SsrfError } from '../utils/ssrf-guard';
import { logger } from '../utils/logger';

/**
 * Hidden-API discovery.
 *
 * The most-repeated efficiency tip from practitioners: "JS-heavy sites are almost
 * always pulling from a JSON/GraphQL source under the hood — hit that instead of
 * rendering the DOM." This loads the page in a real browser, records the XHR/fetch
 * calls it makes, and returns the JSON-ish endpoints so callers can query them
 * directly (cheaper, faster, and far more stable than scraping rendered HTML).
 */

export interface DiscoveredApi {
  url: string;
  method: string;
  status: number;
  contentType: string;
  resourceType: string;
  isJson: boolean;
}

const MAX_APIS = Number(process.env.API_DISCOVERY_MAX ?? 50);
const SETTLE_MS = Number(process.env.API_DISCOVERY_SETTLE_MS ?? 1500);

function looksJson(contentType: string, url: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('application/json') || ct.includes('+json') || ct.includes('graphql')) return true;
  return /\/(api|graphql|gql|v\d+)(\/|\?|$)/i.test(url) || /\.json(\?|$)/i.test(url);
}

/**
 * Load `url` in a browser and capture the JSON/XHR/fetch endpoints it calls.
 */
export async function discoverApis(
  url: string,
  opts: { timeout?: number; includeNonJson?: boolean } = {}
): Promise<{ url: string; apis: DiscoveredApi[]; count: number }> {
  await assertPublicUrl(url);

  const timeout = opts.timeout ?? 30000;
  const pool = BrowserPoolService.getInstance();
  const { page, browserId, contextId } = await pool.getPage();
  const found = new Map<string, DiscoveredApi>();

  page.on('response', (resp) => {
    try {
      const req = resp.request();
      const rt = req.resourceType();
      const ct = resp.headers()['content-type'] ?? '';
      const u = resp.url();
      const jsonish = looksJson(ct, u);
      const isXhr = rt === 'xhr' || rt === 'fetch';
      if (!jsonish && !(opts.includeNonJson && isXhr)) return;
      if (resp.status() >= 400) return;
      const key = `${req.method()} ${u}`;
      if (!found.has(key) && found.size < MAX_APIS) {
        found.set(key, { url: u, method: req.method(), status: resp.status(), contentType: ct, resourceType: rt, isJson: jsonish });
      }
    } catch {
      /* ignore individual response inspection failures */
    }
  });

  try {
    // networkidle lets late XHR/fetch calls fire before we stop listening.
    await page.goto(url, { waitUntil: 'networkidle', timeout }).catch((err) => {
      logger.debug(`API discovery: navigation settled with: ${(err as Error).message}`);
    });
    await page.waitForTimeout(SETTLE_MS);
  } finally {
    await pool.releasePage(page, browserId, contextId);
  }

  const apis = Array.from(found.values()).sort((a, b) => Number(b.isJson) - Number(a.isJson));
  return { url, apis, count: apis.length };
}

export function isSsrfError(err: unknown): err is SsrfError {
  return err instanceof SsrfError;
}
