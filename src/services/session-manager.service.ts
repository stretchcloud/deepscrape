import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { assertPublicUrl, SsrfError } from '../utils/ssrf-guard';
import { HtmlToMarkdownTransformer } from '../transformers/html-to-markdown';
import { extractChildLinks } from '../scraper/crawl-links';
import { proxyService } from './proxy.service';
import { pickFingerprint, buildStealthInitScript } from '../scraper/stealth-hardening';
import { ScraperResponse } from '../types';

/**
 * Persistent interactive browser sessions.
 *
 * Unlike the ephemeral browser pool (acquire page -> scrape -> release), a session
 * keeps a dedicated browser context + page alive across many HTTP calls so a client
 * can drive it step by step (navigate, click, type, scrape) while cookies/auth/JS
 * state persist.
 *
 * Reliability model:
 *  - Sessions live on a dedicated Chromium (separate from the scrape pool) so a
 *    long-held session can never starve scrape throughput, and vice-versa.
 *  - Hard cap (MAX_BROWSER_SESSIONS) + idle TTL + absolute max-lifetime reaping.
 *  - Per-session mutex so two concurrent action requests can't race on one page.
 *  - Every navigate target is SSRF-guarded.
 *
 * Scope caveat: sessions are in-memory and pinned to ONE process. With the
 * ROLE=web|worker split (or multiple replicas) a session created on one process is
 * not reachable from another — front them with sticky routing if you scale out.
 */

export type SessionActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'fill'
  | 'select'
  | 'scroll'
  | 'waitForSelector'
  | 'wait'
  | 'screenshot'
  | 'scrape'
  | 'evaluate'
  | 'back'
  | 'forward'
  | 'reload'
  | 'content';

export interface SessionAction {
  type: SessionActionType;
  url?: string;            // navigate
  selector?: string;       // click/type/fill/select/waitForSelector
  value?: string;          // type/fill/select value
  text?: string;           // alias for value (type/fill)
  position?: number;       // scroll target (pixels); omit = scroll to bottom
  timeout?: number;        // wait (ms) / per-action timeout
  script?: string;         // evaluate (gated by ENABLE_JS_EXECUTION)
  fullPage?: boolean;      // screenshot
  formats?: string[];      // scrape: subset of markdown|html|rawHtml|text|links
  onlyMainContent?: boolean;
  fitMarkdown?: boolean;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

export interface SessionInfo {
  id: string;
  currentUrl: string;
  currentTitle: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  busy: boolean;
  proxyServer?: string;
}

export interface CreateSessionOptions {
  userAgent?: string;
  viewport?: { width: number; height: number };
  proxy?: { server: string; username?: string; password?: string };
  initialUrl?: string;
  stealth?: boolean; // fingerprint hygiene (default on unless SESSION_STEALTH=false)
}

interface Session {
  id: string;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;   // absolute max-lifetime deadline
  currentUrl: string;
  currentTitle: string;
  busy: boolean;
  waiters: Array<() => void>;
  proxyServer?: string;
}

const MAX_SESSIONS = Number(process.env.MAX_BROWSER_SESSIONS ?? 10);
const IDLE_TTL_MS = Number(process.env.SESSION_IDLE_TTL_MS ?? 5 * 60 * 1000);
const MAX_LIFETIME_MS = Number(process.env.SESSION_MAX_LIFETIME_MS ?? 30 * 60 * 1000);
const ACTION_TIMEOUT_MS = Number(process.env.SESSION_ACTION_TIMEOUT_MS ?? 30 * 1000);

export class SessionManagerService {
  private static instance: SessionManagerService;
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly sessions = new Map<string, Session>();
  private reaper?: NodeJS.Timeout;
  private shuttingDown = false;
  private readonly markdown = new HtmlToMarkdownTransformer();

  private constructor() {
    // Reap idle / over-age sessions once a minute.
    this.reaper = setInterval(() => { void this.reapExpired(); }, 60_000);
    if (this.reaper.unref) this.reaper.unref();
  }

  static getInstance(): SessionManagerService {
    if (!SessionManagerService.instance) {
      SessionManagerService.instance = new SessionManagerService();
    }
    return SessionManagerService.instance;
  }

  /** Lazily launch (or relaunch) the dedicated sessions browser. */
  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.launching) return this.launching;

    this.launching = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    }).then((b) => {
      this.browser = b;
      this.launching = null;
      b.on('disconnected', () => {
        if (this.browser === b) this.browser = null;
      });
      logger.info('Session browser launched');
      return b;
    }).catch((err) => {
      this.launching = null;
      throw err;
    });

    return this.launching;
  }

  /** Create a new session and return its info. Throws when at capacity. */
  async createSession(opts: CreateSessionOptions = {}): Promise<SessionInfo> {
    if (this.shuttingDown) throw new Error('Session manager is shutting down');

    // Opportunistically reclaim expired capacity before rejecting.
    await this.reapExpired();
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new SessionCapacityError(`Session limit reached (${MAX_SESSIONS}); close a session or retry later`);
    }

    if (opts.initialUrl) await this.guardNavigate(opts.initialUrl);

    const browser = await this.getBrowser();
    // Use an explicit per-session proxy if given, else rotate through the pool.
    // When rotating and an initial navigation is requested, escalate across up to
    // two proxies so a single dead node doesn't fail session creation.
    const useRotation = !opts.proxy && proxyService.isEnabled();
    const attempts = useRotation && opts.initialUrl ? 2 : 1;
    let lastErr: Error | undefined;

    // One consistent fingerprint for the session's lifetime (hygiene, default on).
    const stealth = opts.stealth !== false && process.env.SESSION_STEALTH !== 'false';
    const fp = stealth ? pickFingerprint() : null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const proxy = opts.proxy ?? (useRotation ? proxyService.next() ?? undefined : undefined);
      const context = await browser.newContext({
        viewport: opts.viewport ?? (fp ? fp.viewport : { width: 1920, height: 1080 }),
        ...(opts.userAgent ? { userAgent: opts.userAgent } : fp ? { userAgent: fp.userAgent } : {}),
        ...(fp ? { locale: fp.locale, timezoneId: fp.timezoneId } : {}),
        ignoreHTTPSErrors: true,
        ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
      });
      if (fp) await context.addInitScript(buildStealthInitScript(fp));
      const page = await context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT_MS);

      const now = Date.now();
      const session: Session = {
        id: randomUUID(),
        context,
        page,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: now + MAX_LIFETIME_MS,
        currentUrl: 'about:blank',
        currentTitle: '',
        busy: false,
        waiters: [],
        proxyServer: proxy?.server,
      };
      this.sessions.set(session.id, session);

      if (opts.initialUrl) {
        try {
          await this.runAction(session.id, { type: 'navigate', url: opts.initialUrl });
          if (proxy) proxyService.report(proxy.server, true);
        } catch (err) {
          lastErr = err as Error;
          await this.closeSession(session.id);
          if (proxy && useRotation) {
            proxyService.report(proxy.server, false);
            logger.warn(`Session initial navigation failed via proxy ${proxy.server}, escalating: ${lastErr.message}`);
            continue; // try the next proxy
          }
          throw err;
        }
      }

      logger.info(`Session ${session.id} created (${this.sessions.size}/${MAX_SESSIONS})${proxy ? ` via ${proxy.server}` : ''}`);
      return this.toInfo(this.sessions.get(session.id)!);
    }

    throw lastErr ?? new Error('Failed to create session');
  }

  getSession(id: string): SessionInfo | null {
    const s = this.sessions.get(id);
    return s ? this.toInfo(s) : null;
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => this.toInfo(s));
  }

  /** Run one action against a session, serialized per-session. */
  async runAction(id: string, action: SessionAction): Promise<Record<string, any>> {
    const session = this.sessions.get(id);
    if (!session) throw new SessionNotFoundError(`Session ${id} not found`);

    await this.acquire(session);
    try {
      const result = await this.dispatch(session, action);
      session.lastUsedAt = Date.now();
      // Refresh URL/title snapshot after every action (cheap and keeps info current).
      try {
        session.currentUrl = session.page.url();
        session.currentTitle = await session.page.title();
      } catch { /* page may be mid-navigation */ }
      return result;
    } finally {
      this.release(session);
    }
  }

  async closeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    try {
      await session.context.close();
    } catch (err) {
      logger.debug(`Error closing session ${id}: ${(err as Error).message}`);
    }
    logger.info(`Session ${id} closed`);
    return true;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.reaper) clearInterval(this.reaper);
    await Promise.all(Array.from(this.sessions.keys()).map((id) => this.closeSession(id)));
    try {
      if (this.browser?.isConnected()) await this.browser.close();
    } catch { /* ignore */ }
    this.browser = null;
  }

  // --- action dispatch ---

  private async dispatch(session: Session, action: SessionAction): Promise<Record<string, any>> {
    const { page } = session;
    const timeout = action.timeout ?? ACTION_TIMEOUT_MS;

    switch (action.type) {
      case 'navigate': {
        if (!action.url) throw new Error('navigate requires `url`');
        await this.guardNavigate(action.url);
        await page.goto(action.url, { waitUntil: action.waitUntil ?? 'domcontentloaded', timeout });
        return { url: page.url(), title: await page.title() };
      }
      case 'click': {
        if (!action.selector) throw new Error('click requires `selector`');
        await page.click(action.selector, { timeout });
        return { clicked: action.selector };
      }
      case 'type':
      case 'fill': {
        if (!action.selector) throw new Error(`${action.type} requires \`selector\``);
        const value = action.value ?? action.text ?? '';
        if (action.type === 'type') await page.type(action.selector, value, { timeout });
        else await page.fill(action.selector, value, { timeout });
        return { [action.type]: action.selector };
      }
      case 'select': {
        if (!action.selector) throw new Error('select requires `selector`');
        const selected = await page.selectOption(action.selector, action.value ?? '', { timeout });
        return { selected };
      }
      case 'scroll': {
        const pos = action.position;
        await page.evaluate((p) => {
          const y = typeof p === 'number' ? p : document.body.scrollHeight;
          window.scrollTo(0, y);
        }, pos ?? null);
        return { scrolledTo: pos ?? 'bottom' };
      }
      case 'waitForSelector': {
        if (!action.selector) throw new Error('waitForSelector requires `selector`');
        await page.waitForSelector(action.selector, { timeout });
        return { appeared: action.selector };
      }
      case 'wait': {
        await page.waitForTimeout(Math.min(action.timeout ?? 1000, 30_000));
        return { waited: Math.min(action.timeout ?? 1000, 30_000) };
      }
      case 'screenshot': {
        const buf = await page.screenshot({ fullPage: action.fullPage ?? false, type: 'png' });
        return { screenshot: `data:image/png;base64,${buf.toString('base64')}` };
      }
      case 'back': {
        await page.goBack({ waitUntil: action.waitUntil ?? 'domcontentloaded', timeout });
        return { url: page.url() };
      }
      case 'forward': {
        await page.goForward({ waitUntil: action.waitUntil ?? 'domcontentloaded', timeout });
        return { url: page.url() };
      }
      case 'reload': {
        await page.reload({ waitUntil: action.waitUntil ?? 'domcontentloaded', timeout });
        return { url: page.url() };
      }
      case 'evaluate': {
        if (process.env.ENABLE_JS_EXECUTION === 'false') {
          throw new Error('JS execution is disabled (ENABLE_JS_EXECUTION=false)');
        }
        if (!action.script) throw new Error('evaluate requires `script`');

        const jsResult = await page.evaluate(`(async () => { ${action.script} })()`);
        return { jsResult };
      }
      case 'content':
      case 'scrape': {
        return this.extractCurrent(session, action);
      }
      default:
        throw new Error(`Unknown action type: ${(action as SessionAction).type}`);
    }
  }

  /** Extract the CURRENT (already-loaded) page into the requested formats. */
  private async extractCurrent(session: Session, action: SessionAction): Promise<Record<string, any>> {
    const { page } = session;
    const html = await page.content();
    const url = page.url();
    const title = await page.title().catch(() => '');
    const formats = (action.formats && action.formats.length ? action.formats : ['markdown']).map((f) => f.toLowerCase());

    const base: ScraperResponse = {
      url,
      title,
      content: html,
      contentType: 'html',
      metadata: { timestamp: new Date().toISOString(), status: 200, headers: {} },
    };

    const out: Record<string, any> = { url, title };
    if (formats.includes('rawhtml') || formats.includes('html')) out.html = html;
    if (formats.includes('markdown')) {
      out.markdown = this.markdown.transform(base, action.onlyMainContent !== false, action.fitMarkdown !== false).content;
    }
    if (formats.includes('text')) {
      out.text = await page.evaluate(() => document.body?.innerText ?? '');
    }
    if (formats.includes('links')) {
      out.links = extractChildLinks(html, url);
    }
    return out;
  }

  // --- helpers ---

  private async guardNavigate(url: string): Promise<void> {
    try {
      await assertPublicUrl(url);
    } catch (err) {
      if (err instanceof SsrfError) {
        throw new Error(`Blocked: target URL resolves to a non-public address (${url})`);
      }
      throw err;
    }
  }

  /** Per-session mutex acquire. */
  private async acquire(session: Session): Promise<void> {
    if (!session.busy) {
      session.busy = true;
      return;
    }
    await new Promise<void>((resolve) => session.waiters.push(resolve));
    session.busy = true;
  }

  private release(session: Session): void {
    const next = session.waiters.shift();
    if (next) {
      next();
    } else {
      session.busy = false;
    }
  }

  private toInfo(s: Session): SessionInfo {
    return {
      id: s.id,
      currentUrl: s.currentUrl,
      currentTitle: s.currentTitle,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      busy: s.busy,
      proxyServer: s.proxyServer,
    };
  }

  /** Close sessions that are idle past IDLE_TTL or older than MAX_LIFETIME. */
  private async reapExpired(): Promise<void> {
    const now = Date.now();
    const toClose: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.busy) continue;
      if (now - s.lastUsedAt > IDLE_TTL_MS || now >= s.expiresAt) toClose.push(s.id);
    }
    for (const id of toClose) {
      logger.info(`Reaping expired session ${id}`);
      await this.closeSession(id);
    }
  }
}

export class SessionNotFoundError extends Error {}
export class SessionCapacityError extends Error {}

export const sessionManager = SessionManagerService.getInstance();
