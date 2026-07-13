import { createHash } from 'crypto';
import { CssExtractionSchema, CssFieldType } from './css-extractor';

/**
 * Pure (I/O-free) core of self-healing extraction: cache-key derivation, yield
 * validation (breakage detection), and coercion of arbitrary LLM output into a
 * valid CSS schema. Kept separate from the service so it has no Redis/LLM imports
 * and is trivially unit-testable.
 */

export const HEALTHY_FIELD_RATIO = Number(process.env.SELF_HEAL_HEALTHY_RATIO ?? 0.5);
export const VALID_CSS_TYPES: CssFieldType[] = ['text', 'attribute', 'html', 'number', 'list', 'nested', 'nested_list'];

export interface DesiredField {
  name: string;
  description?: string;
  type?: CssFieldType;
  attribute?: string;
  required?: boolean;
}

/** Normalize a URL to a page-*type* signature so /products/1 and /products/2 share a schema. */
export function siteSignature(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
      .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id');
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}

export function fieldsFingerprint(fields: DesiredField[]): string {
  return fields.map(f => `${f.name}:${f.type ?? 'text'}`).sort().join(',');
}

export function schemaCacheKey(url: string, fields: DesiredField[]): string {
  const h = createHash('sha256').update(`${siteSignature(url)}::${fieldsFingerprint(fields)}`).digest('hex').slice(0, 40);
  return `selfheal:${h}`;
}

export function isPopulated(v: any): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/**
 * Decide whether extracted records look healthy, i.e. the selectors are still
 * matching. Breakage shows up as zero records or required fields going empty.
 */
export function validateYield(
  records: Record<string, any>[],
  requiredFields: string[]
): { healthy: boolean; recordCount: number; populatedRequiredRatio: number } {
  const recordCount = records.length;
  if (recordCount === 0) return { healthy: false, recordCount: 0, populatedRequiredRatio: 0 };

  if (requiredFields.length === 0) {
    const anyPopulated = records.some(r => Object.values(r).some(isPopulated));
    return { healthy: anyPopulated, recordCount, populatedRequiredRatio: anyPopulated ? 1 : 0 };
  }

  const ratios = requiredFields.map(
    f => records.filter(r => isPopulated(r[f])).length / recordCount
  );
  const minRatio = Math.min(...ratios);
  return { healthy: minRatio >= HEALTHY_FIELD_RATIO, recordCount, populatedRequiredRatio: minRatio };
}

/** Coerce arbitrary LLM output into a valid CssExtractionSchema, keeping only requested fields. */
export function coerceToSchema(raw: any, fields: DesiredField[]): CssExtractionSchema | null {
  if (!raw || typeof raw !== 'object') return null;
  const wanted = new Map(fields.map(f => [f.name, f]));
  const baseSelector = typeof raw.baseSelector === 'string' && raw.baseSelector.trim() ? raw.baseSelector.trim() : 'body';

  const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
  const outFields = rawFields
    .filter((f: any) => f && typeof f.name === 'string' && wanted.has(f.name))
    .map((f: any) => {
      const want = wanted.get(f.name)!;
      const type: CssFieldType = VALID_CSS_TYPES.includes(f.type) ? f.type : (want.type ?? 'text');
      const field: any = {
        name: f.name,
        selector: typeof f.selector === 'string' ? f.selector : '',
        type,
      };
      if (type === 'attribute') field.attribute = f.attribute ?? want.attribute ?? 'href';
      return field;
    });

  if (outFields.length === 0) return null;
  return { name: 'self-healed', baseSelector, fields: outFields };
}
