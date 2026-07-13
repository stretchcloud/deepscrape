import { logger } from '../utils/logger';

/**
 * Proxy rotation for the browser scrape path.
 *
 * Operators configure a pool of egress proxies (their own or a commercial pool)
 * via env; the service hands them out round-robin, tracks per-proxy health, and
 * puts a proxy on a short cooldown after repeated failures so a dead node stops
 * receiving traffic. Applied to Playwright contexts (pool + interactive sessions
 * + agent) where it composes cleanly with the SSRF pre-flight.
 *
 * Deliberately NOT applied to the HTTP/axios path: that path pins each connection
 * to a pre-validated public IP (per-hop SSRF protection), which an HTTP proxy would
 * bypass. Browser-rendered scrapes are also where proxies matter most.
 *
 * This is proxy *rotation* infrastructure only — there is no CAPTCHA-solving or
 * bot-detection-bypass component, by design.
 *
 * Env:
 *   PROXY_LIST           comma-separated proxy servers, e.g.
 *                        "http://host:8000,http://user:pass@host2:8000"
 *   PROXY_USERNAME       shared username (when not embedded per-proxy)
 *   PROXY_PASSWORD       shared password
 *   PROXY_ENABLED        set "false" to disable without clearing the list
 *   PROXY_MAX_FAILURES   consecutive failures before cooldown (default 3)
 *   PROXY_COOLDOWN_MS    cooldown duration (default 60000)
 */

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

interface ProxyEntry extends ProxyConfig {
  failures: number;
  cooldownUntil: number;
}

const MAX_FAILURES = Number(process.env.PROXY_MAX_FAILURES ?? 3);
const COOLDOWN_MS = Number(process.env.PROXY_COOLDOWN_MS ?? 60_000);

export class ProxyService {
  private static instance: ProxyService;
  private entries: ProxyEntry[] = [];
  private cursor = 0;

  private constructor() {
    this.load();
  }

  static getInstance(): ProxyService {
    if (!ProxyService.instance) ProxyService.instance = new ProxyService();
    return ProxyService.instance;
  }

  /** (Re)load the proxy pool from env. */
  load(): void {
    const raw = (process.env.PROXY_LIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const sharedUser = process.env.PROXY_USERNAME || undefined;
    const sharedPass = process.env.PROXY_PASSWORD || undefined;

    this.entries = raw.map((item) => this.parse(item, sharedUser, sharedPass)).filter(Boolean) as ProxyEntry[];
    this.cursor = 0;
    if (this.entries.length) {
      logger.info(`Proxy pool loaded: ${this.entries.length} prox(ies)${this.isEnabled() ? '' : ' (disabled)'}`);
    }
  }

  /** Parse "scheme://[user:pass@]host:port" into an entry. */
  private parse(item: string, sharedUser?: string, sharedPass?: string): ProxyEntry | null {
    try {
      const withScheme = /:\/\//.test(item) ? item : `http://${item}`;
      const u = new URL(withScheme);
      const username = u.username ? decodeURIComponent(u.username) : sharedUser;
      const password = u.password ? decodeURIComponent(u.password) : sharedPass;
      const server = `${u.protocol}//${u.host}`;
      return { server, username, password, failures: 0, cooldownUntil: 0 };
    } catch {
      logger.warn(`Ignoring malformed proxy entry: ${item}`);
      return null;
    }
  }

  isEnabled(): boolean {
    return process.env.PROXY_ENABLED !== 'false' && this.entries.length > 0;
  }

  /** Next healthy proxy (round-robin), or null when none are configured/healthy. */
  next(): ProxyConfig | null {
    if (!this.isEnabled()) return null;
    const now = Date.now();
    const n = this.entries.length;
    for (let i = 0; i < n; i++) {
      const entry = this.entries[this.cursor % n];
      this.cursor = (this.cursor + 1) % n;
      if (entry.cooldownUntil <= now) {
        return { server: entry.server, username: entry.username, password: entry.password };
      }
    }
    // Every proxy is cooling down — fall back to the one whose cooldown ends soonest.
    const soonest = [...this.entries].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
    return soonest ? { server: soonest.server, username: soonest.username, password: soonest.password } : null;
  }

  /** Report the outcome of a request that used `server`. */
  report(server: string | undefined, ok: boolean): void {
    if (!server) return;
    const entry = this.entries.find((e) => e.server === server);
    if (!entry) return;
    if (ok) {
      entry.failures = 0;
      entry.cooldownUntil = 0;
    } else {
      entry.failures += 1;
      if (entry.failures >= MAX_FAILURES) {
        entry.cooldownUntil = Date.now() + COOLDOWN_MS;
        entry.failures = 0;
        logger.warn(`Proxy ${server} put on cooldown for ${COOLDOWN_MS}ms after repeated failures`);
      }
    }
  }

  stats(): { enabled: boolean; total: number; healthy: number; proxies: Array<{ server: string; healthy: boolean; failures: number }> } {
    const now = Date.now();
    return {
      enabled: this.isEnabled(),
      total: this.entries.length,
      healthy: this.entries.filter((e) => e.cooldownUntil <= now).length,
      proxies: this.entries.map((e) => ({ server: e.server, healthy: e.cooldownUntil <= now, failures: e.failures })),
    };
  }
}

export const proxyService = ProxyService.getInstance();
