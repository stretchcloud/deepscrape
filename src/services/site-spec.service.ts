import { randomUUID } from 'crypto';
import { redisClient } from './redis.service';
import { logger } from '../utils/logger';
import scraperManager from '../scraper/scraper-manager';
import { assertPublicUrl, SsrfError } from '../utils/ssrf-guard';
import { sessionManager, SessionNotFoundError } from './session-manager.service';
import { selfHealExtract } from './self-heal-extractor.service';
import { DesiredField } from '../transformers/self-heal-core';
import { CssExtractionSchema } from '../transformers/css-extractor';
import {
  SiteSpec,
  SiteSpecParam,
  SiteHealth,
  isValidSpecName,
  resolveUrlTemplate,
  templatePlaceholders,
} from '../transformers/site-spec-core';

/**
 * SiteSpec store + run orchestrator.
 *
 * A SiteSpec is a saved, named, reusable extraction over a URL (or URL template).
 * Running one is pure composition of shipped parts: resolve the templated URL
 * (SSRF-guarded), scrape raw HTML, self-heal-extract with the spec's stored
 * schema, persist the healed schema back onto the spec, and report health. Each
 * spec is exposed to agents as an MCP tool.
 *
 * Specs are stored in Redis WITHOUT a TTL (durable), unlike the 7-day self-heal
 * cache — so the derived schema lives with the spec and heals in place.
 */

const SPEC_KEY = (id: string) => `sitespec:${id}`;
const NAME_KEY = (name: string) => `sitespec:name:${name}`;
const INDEX_KEY = 'sitespecs';

export interface CreateSpecInput {
  name: string;
  description?: string;
  url: string;                 // urlTemplate (may contain {param})
  params?: SiteSpecParam[];
  fields: DesiredField[];
  cssSchema?: CssExtractionSchema; // optional bootstrap (skips first LLM derivation)
  sampleParams?: Record<string, unknown>; // values used to fetch a page for derivation
  sessionId?: string;          // bind to a pre-authenticated session (auth'd/internal sites)
  verify?: boolean;
}

export interface RunResult {
  success: boolean;
  error?: string;
  url?: string;
  data?: Record<string, any>[];
  recordCount?: number;
  health?: SiteHealth;
  healthy?: boolean;
  fieldFillRatio?: number;   // fraction of required fields populated (the reliability signal)
  source?: string;           // cache | provided | derived | healed
  healed?: boolean;
}

// --- store ---

async function save(spec: SiteSpec): Promise<void> {
  await redisClient.set(SPEC_KEY(spec.id), JSON.stringify(spec));
  await redisClient.set(NAME_KEY(spec.name), spec.id);
  await redisClient.sadd(INDEX_KEY, spec.id);
}

export async function getSpec(id: string): Promise<SiteSpec | null> {
  const raw = await redisClient.get(SPEC_KEY(id));
  return raw ? (JSON.parse(raw) as SiteSpec) : null;
}

export async function getSpecByName(name: string): Promise<SiteSpec | null> {
  const id = await redisClient.get(NAME_KEY(name));
  return id ? getSpec(id) : null;
}

export async function listSpecs(): Promise<SiteSpec[]> {
  const ids = await redisClient.smembers(INDEX_KEY);
  if (ids.length === 0) return [];
  const raws = await Promise.all(ids.map(id => redisClient.get(SPEC_KEY(id))));
  return raws.filter(Boolean).map(r => JSON.parse(r as string) as SiteSpec).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteSpec(id: string): Promise<boolean> {
  const spec = await getSpec(id);
  if (!spec) return false;
  await redisClient.del(SPEC_KEY(id));
  await redisClient.del(NAME_KEY(spec.name));
  await redisClient.srem(INDEX_KEY, id);
  return true;
}

// --- validation helpers ---

export class SpecValidationError extends Error {}
export class SpecNotFoundError extends Error {}

function assertParamsCoverTemplate(urlTemplate: string, params: SiteSpecParam[]): void {
  const placeholders = templatePlaceholders(urlTemplate);
  const declared = new Set(params.map(p => p.name));
  const missing = placeholders.filter(p => !declared.has(p));
  if (missing.length > 0) {
    throw new SpecValidationError(`urlTemplate uses undeclared param(s): ${missing.join(', ')}`);
  }
}

// --- create ---

export async function createSpec(input: CreateSpecInput): Promise<{ spec: SiteSpec; sample: Record<string, any>[]; meta: any }> {
  if (!isValidSpecName(input.name)) {
    throw new SpecValidationError('name must match ^[a-z0-9_]{1,48}$ (lowercase letters, digits, underscore)');
  }
  if (await getSpecByName(input.name)) {
    throw new SpecValidationError(`a spec named "${input.name}" already exists`);
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    throw new SpecValidationError('at least one field is required');
  }
  const params = input.params ?? [];
  assertParamsCoverTemplate(input.url, params);

  // Resolve a concrete URL to derive the schema from (needs sample values for templates).
  const url = resolveUrlTemplate(input.url, input.sampleParams ?? {});
  await guardUrl(url);

  // If bound to a session, the session must already exist (the user authenticates
  // it themselves — we never store credentials, only the session reference).
  if (input.sessionId && !sessionManager.getSession(input.sessionId)) {
    throw new SpecValidationError(`session "${input.sessionId}" not found — create and authenticate it first, then bind`);
  }

  const fetched = await fetchSpecHtml(url, input.sessionId);
  if (fetched.error) throw new SpecValidationError(`could not fetch ${url}: ${fetched.error}`);
  const html = fetched.html;

  const result = await selfHealExtract({ url, html, fields: input.fields, providedSchema: input.cssSchema });
  if (!result.success || !result.meta?.schema) {
    throw new SpecValidationError(result.error ?? 'could not derive a working extraction schema (provide cssSchema or configure an LLM)');
  }

  const now = Date.now();
  const spec: SiteSpec = {
    id: randomUUID(),
    name: input.name,
    description: input.description ?? '',
    urlTemplate: input.url,
    params,
    fields: input.fields,
    cssSchema: result.meta.schema,
    sessionId: input.sessionId,
    verify: input.verify ?? false,
    health: result.meta.healthy ? 'healthy' : 'degraded',
    lastVerifiedAt: now,
    lastError: result.meta.healthy ? null : 'initial extraction yielded low/no data',
    createdAt: now,
    updatedAt: now,
  };
  await save(spec);
  logger.info(`SiteSpec "${spec.name}" created (${spec.id}), health=${spec.health}`);
  return { spec, sample: result.data ?? [], meta: result.meta };
}

// --- run ---

export async function runSpec(spec: SiteSpec, params: Record<string, unknown> = {}): Promise<RunResult> {
  let url: string;
  try {
    url = resolveUrlTemplate(spec.urlTemplate, params);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  try {
    await guardUrl(url);
  } catch (err) {
    return { success: false, error: (err as Error).message, url };
  }

  const fetched = await fetchSpecHtml(url, spec.sessionId);
  if (fetched.error) {
    await updateHealth(spec, 'degraded', fetched.error);
    return { success: false, error: fetched.error, url, health: 'degraded' };
  }
  const html = fetched.html;

  const result = await selfHealExtract({ url, html, fields: spec.fields, providedSchema: spec.cssSchema });

  // Self-heal in place: if the selectors were re-derived, persist the new schema.
  if (result.meta?.healed && result.meta.schema) {
    spec.cssSchema = result.meta.schema;
    spec.updatedAt = Date.now();
    await save(spec);
    logger.info(`SiteSpec "${spec.name}" healed its schema on run`);
  }

  const healthy = Boolean(result.meta?.healthy);
  await updateHealth(spec, healthy ? 'healthy' : 'degraded', healthy ? null : (result.meta?.note ?? 'low/no data'));

  return {
    success: result.success,
    error: result.error,
    url,
    data: result.data,
    recordCount: result.meta?.recordCount ?? (result.data?.length ?? 0),
    health: healthy ? 'healthy' : 'degraded',
    healthy,
    fieldFillRatio: result.meta?.populatedRequiredRatio,
    source: result.meta?.source,
    healed: result.meta?.healed,
  };
}

/** Run a spec by id (loads it first). */
export async function runSpecById(id: string, params: Record<string, unknown> = {}): Promise<RunResult> {
  const spec = await getSpec(id);
  if (!spec) throw new SpecNotFoundError(`spec ${id} not found`);
  return runSpec(spec, params);
}

/** Run a spec by name — the stable, human-meaningful identifier agents use. */
export async function runSpecByName(name: string, params: Record<string, unknown> = {}): Promise<RunResult> {
  const spec = await getSpecByName(name);
  if (!spec) throw new SpecNotFoundError(`spec "${name}" not found`);
  return runSpec(spec, params);
}

// --- verify (scheduled + on-demand) ---

/** Force a verify: re-run with sampleless params (template with no params only), self-heal on drift. */
export async function verifySpec(spec: SiteSpec): Promise<RunResult> {
  // Verification can only auto-run specs whose template needs no params (we have no
  // sample values at schedule time). Parameterized specs are marked accordingly.
  if (templatePlaceholders(spec.urlTemplate).length > 0) {
    await updateHealth(spec, spec.health, spec.lastError ?? null); // no-op touch
    return { success: false, error: 'parameterized spec — verify by calling /run with params', health: spec.health };
  }
  return runSpec(spec, {});
}

/** Verify all specs that opted in and are auto-verifiable (no required params). */
export async function verifyAllDue(): Promise<{ checked: number; healthy: number; degraded: number }> {
  const specs = (await listSpecs()).filter(s => s.verify && templatePlaceholders(s.urlTemplate).length === 0);
  let healthy = 0;
  let degraded = 0;
  for (const spec of specs) {
    try {
      const r = await runSpec(spec, {});
      if (r.healthy) healthy++;
      else degraded++;
    } catch (err) {
      degraded++;
      logger.warn(`SiteSpec verify failed for "${spec.name}": ${(err as Error).message}`);
    }
  }
  if (specs.length) logger.info(`SiteSpec verifier: checked ${specs.length}, healthy ${healthy}, degraded ${degraded}`);
  return { checked: specs.length, healthy, degraded };
}

// --- scheduler ---

let verifyTimer: NodeJS.Timeout | undefined;

export function startSiteVerifier(): void {
  const intervalMs = Number(process.env.SITE_VERIFY_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
  if (intervalMs <= 0) {
    logger.info('SiteSpec verifier disabled (SITE_VERIFY_INTERVAL_MS<=0)');
    return;
  }
  verifyTimer = setInterval(() => { void verifyAllDue().catch(err => logger.error(`SiteSpec verifier error: ${err.message}`)); }, intervalMs);
  if (verifyTimer.unref) verifyTimer.unref();
  logger.info(`SiteSpec verifier started (every ${Math.round(intervalMs / 3600000)}h)`);
}

export function stopSiteVerifier(): void {
  if (verifyTimer) clearInterval(verifyTimer);
  verifyTimer = undefined;
}

// --- internals ---

async function guardUrl(url: string): Promise<void> {
  try {
    await assertPublicUrl(url);
  } catch (err) {
    if (err instanceof SsrfError) throw new SpecValidationError(`blocked: ${url} resolves to a non-public address`);
    throw err;
  }
}

function htmlOf(scrape: { rawHtml?: string; content?: string; contentType?: string }): string {
  return scrape.rawHtml ?? (scrape.contentType === 'html' ? scrape.content ?? '' : '') ?? '';
}

/**
 * Fetch a spec's target HTML. When bound to a session, navigate + read the page
 * WITHIN that pre-authenticated context (so gated/internal pages work) — we hold
 * only the session reference, never credentials. Otherwise a stateless scrape.
 */
async function fetchSpecHtml(url: string, sessionId?: string): Promise<{ html: string; error?: string }> {
  if (sessionId) {
    try {
      await sessionManager.runAction(sessionId, { type: 'navigate', url });
      const res = await sessionManager.runAction(sessionId, { type: 'scrape', formats: ['html'] });
      return { html: (res.html as string) ?? '' };
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        return { html: '', error: 'bound session expired or not found — re-create the session, authenticate it, and re-bind the spec' };
      }
      return { html: '', error: (err as Error).message };
    }
  }
  const scrape = await scraperManager.scrape(url, { includeRawHtml: true });
  if (scrape.error) return { html: '', error: scrape.error };
  return { html: htmlOf(scrape) };
}

async function updateHealth(spec: SiteSpec, health: SiteHealth, error: string | null): Promise<void> {
  spec.health = health;
  spec.lastVerifiedAt = Date.now();
  spec.lastError = error;
  await save(spec);
}
