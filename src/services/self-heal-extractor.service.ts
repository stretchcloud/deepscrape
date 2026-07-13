import * as cheerio from 'cheerio';
import { redisClient } from './redis.service';
import { LLMServiceFactory } from './llm-service-factory';
import { extractWithCssSchema, CssExtractionSchema } from '../transformers/css-extractor';
import {
  DesiredField,
  schemaCacheKey,
  validateYield,
  coerceToSchema,
} from '../transformers/self-heal-core';
import { logger } from '../utils/logger';

/**
 * Self-healing structured extraction.
 *
 * The pattern practitioners trust (and hand-roll today because no turnkey tool
 * does it): use an LLM ONCE to derive robust CSS selectors, cache them, then run
 * deterministic — free, fast, reliable — extraction on every subsequent call.
 * When the site changes and the cached selectors stop yielding data (breakage),
 * re-derive with the LLM and re-cache. This directly attacks the #1 maintenance
 * pain ("~10-15% of scrapers break every week").
 *
 * It ties together the two halves DeepScrape already has: the deterministic
 * `extractWithCssSchema` (cheerio) and the LLM. The LLM's role here is to write
 * the *schema*, not to read every page — so cost stays near zero at steady state.
 * The pure logic (cache keys, yield validation, schema coercion) lives in
 * `self-heal-core` so it is I/O-free and unit-testable.
 */

const SCHEMA_TTL = Number(process.env.SELF_HEAL_SCHEMA_TTL ?? 7 * 24 * 60 * 60); // 7 days
const MAX_HTML_CHARS = Number(process.env.SELF_HEAL_MAX_HTML_CHARS ?? 40000);

export type { DesiredField };
export type SelfHealSource = 'cache' | 'provided' | 'derived' | 'healed';

export interface SelfHealResult {
  success: boolean;
  data?: Record<string, any>[];
  error?: string;
  meta?: {
    source: SelfHealSource;
    healed: boolean;
    healthy: boolean;
    degraded?: boolean;
    note?: string;
    recordCount: number;
    populatedRequiredRatio: number;
    schemaId: string;
    baseSelector: string;
    schema: CssExtractionSchema;
  };
}

/** Strip noise and truncate HTML into a sample the LLM can reason over cheaply. */
function htmlSample(html: string): string {
  try {
    const $ = cheerio.load(html);
    $('script, style, svg, noscript, iframe, link, meta').remove();
    const body = $('body').html() ?? $.html();
    return (body || html).slice(0, MAX_HTML_CHARS);
  } catch {
    return html.slice(0, MAX_HTML_CHARS);
  }
}

const DERIVE_SYSTEM = `You write CSS-selector extraction schemas for web pages. Given HTML and a list of fields to extract, respond with STRICT JSON only:
{ "baseSelector": "<css selector for the repeating record container, or a single container>", "fields": [ { "name": "<field name>", "selector": "<css selector RELATIVE to baseSelector>", "type": "text|attribute|number|list|html", "attribute": "<only for type=attribute>" } ] }

Rules:
- baseSelector selects each repeated record (e.g. "div.product", "li.result"). For a single-record page use the smallest stable container (e.g. "main", "article", "body").
- Field selectors are evaluated RELATIVE to baseSelector. Use "" (empty string) to mean the base element itself.
- Prefer stable class/attribute/semantic selectors; AVOID :nth-child and long brittle chains.
- type: "text" for visible text, "attribute" (+ "attribute" name, e.g. href/src) for links/images, "number" for numeric text, "list" for repeated child values.
- Output ONLY the JSON object.`;

async function deriveSchema(html: string, fields: DesiredField[], url: string): Promise<CssExtractionSchema | null> {
  const llm = LLMServiceFactory.createLLMService();
  if (!llm) return null;

  const fieldList = fields
    .map(f => `- ${f.name}${f.type ? ` (type: ${f.type})` : ''}${f.description ? `: ${f.description}` : ''}`)
    .join('\n');
  const user = `URL: ${url}\n\nFields to extract:\n${fieldList}\n\nHTML:\n${htmlSample(html)}`;

  const resp = await llm.getCompletion<any>(
    [{ role: 'system', content: DERIVE_SYSTEM }, { role: 'user', content: user }],
    { temperature: 0, maxTokens: 1500 },
    { type: 'json_object' }
  );
  if (!resp.success || !resp.data) {
    logger.warn(`Self-heal: schema derivation failed for ${url}: ${resp.error ?? 'no data'}`);
    return null;
  }
  return coerceToSchema(resp.data, fields);
}

async function getCachedSchema(key: string): Promise<CssExtractionSchema | null> {
  try {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as CssExtractionSchema) : null;
  } catch {
    return null;
  }
}

async function setCachedSchema(key: string, schema: CssExtractionSchema): Promise<void> {
  try {
    await redisClient.set(key, JSON.stringify(schema), 'EX', SCHEMA_TTL);
  } catch (err) {
    logger.warn(`Self-heal: failed to cache schema: ${(err as Error).message}`);
  }
}

/**
 * Extract `fields` from `html` using a cached/derived CSS schema, healing on breakage.
 */
export async function selfHealExtract(params: {
  url: string;
  html: string;
  fields: DesiredField[];
  providedSchema?: CssExtractionSchema;
  forceReheal?: boolean;
}): Promise<SelfHealResult> {
  const { url, html, fields, providedSchema, forceReheal } = params;
  if (!html) return { success: false, error: 'no HTML to extract from' };
  if (!fields || fields.length === 0) return { success: false, error: 'at least one field is required' };

  const requiredFields = fields.filter(f => f.required).map(f => f.name);
  const cacheKey = schemaCacheKey(url, fields);

  // Resolve a starting schema: explicit override > cache (unless forced to re-derive).
  let schema: CssExtractionSchema | null = null;
  let source: SelfHealSource | null = null;
  if (providedSchema && !forceReheal) {
    schema = providedSchema;
    source = 'provided';
  } else if (!forceReheal) {
    const cached = await getCachedSchema(cacheKey);
    if (cached) {
      schema = cached;
      source = 'cache';
    }
  }

  // Deterministic attempt with the resolved schema.
  if (schema && source) {
    const records = extractWithCssSchema(html, schema);
    const y = validateYield(records, requiredFields);
    if (y.healthy) {
      if (source === 'provided') await setCachedSchema(cacheKey, schema);
      return {
        success: true,
        data: records,
        meta: { source, healed: false, healthy: true, recordCount: y.recordCount, populatedRequiredRatio: y.populatedRequiredRatio, schemaId: cacheKey, baseSelector: schema.baseSelector, schema },
      };
    }
    logger.info(`Self-heal: cached/provided selectors look broken for ${url} (records=${y.recordCount}), re-deriving`);
  }

  // Derive (or re-derive on breakage) via the LLM.
  const wasBroken = Boolean(schema);
  const derived = await deriveSchema(html, fields, url);

  if (!derived) {
    // No LLM available to derive. Return the broken schema's best-effort output honestly.
    if (schema) {
      const records = extractWithCssSchema(html, schema);
      return {
        success: true,
        data: records,
        meta: { source: source!, healed: false, healthy: false, degraded: true, note: 'cached selectors may be stale and no LLM is configured to re-derive them (set OPENAI_API_KEY)', recordCount: records.length, populatedRequiredRatio: 0, schemaId: cacheKey, baseSelector: schema.baseSelector, schema },
      };
    }
    return { success: false, error: 'Cannot derive selectors: no cached/provided schema and no LLM configured (set OPENAI_API_KEY or pass cssSchema)' };
  }

  const records = extractWithCssSchema(html, derived);
  const y = validateYield(records, requiredFields);
  await setCachedSchema(cacheKey, derived);
  return {
    success: true,
    data: records,
    meta: { source: wasBroken ? 'healed' : 'derived', healed: wasBroken, healthy: y.healthy, recordCount: y.recordCount, populatedRequiredRatio: y.populatedRequiredRatio, schemaId: cacheKey, baseSelector: derived.baseSelector, schema: derived },
  };
}
