import * as cheerio from 'cheerio';

/**
 * Deterministic, LLM-free structured extraction driven by CSS selectors.
 *
 * This is a self-contained TypeScript port of an upstream project's `JsonCssExtractionStrategy`.
 * Given an HTML document and a declarative schema, it produces one plain record per
 * element matching the schema's `baseSelector`. Every field is resolved *relative to*
 * its base element, so the same schema can be reused across repeated page structures
 * (product grids, search results, review lists, etc.) without any model calls.
 *
 * The module intentionally takes plain inputs (a string + a schema object) and returns
 * plain outputs (an array of records). It never throws for missing fields or malformed
 * markup — callers always receive a well-formed array.
 */

/** The kinds of values a field can resolve to. */
export type CssFieldType =
  | 'text'
  | 'attribute'
  | 'html'
  | 'number'
  | 'list'
  | 'nested'
  | 'nested_list';

/**
 * A single field in an extraction schema.
 *
 * `selector` is always evaluated relative to the current base element. An empty
 * selector (or `'.'`) refers to the base element itself rather than a descendant.
 */
export interface CssField {
  /** Key the resolved value is stored under in the output record. */
  name: string;
  /** CSS selector, scoped to the base element (descendant search). */
  selector: string;
  /** How the matched element(s) are converted into a value. */
  type: CssFieldType;
  /** Attribute name to read — required for (and only used by) `type: 'attribute'`. */
  attribute?: string;
  /** Child field definitions — required for `type: 'nested'` and `'nested_list'`. */
  fields?: CssField[];
}

/** A complete extraction schema. */
export interface CssExtractionSchema {
  /** Optional human-readable name for the schema (metadata only). */
  name?: string;
  /** Selector whose every match produces one output record. */
  baseSelector: string;
  /** Fields resolved against each base match. */
  fields: CssField[];
}

/**
 * Extract structured records from `html` using a CSS-selector `schema`.
 *
 * @param html   Raw HTML markup (may be malformed).
 * @param schema Declarative extraction schema.
 * @returns One record per `baseSelector` match. Empty array when nothing matches,
 *          the inputs are empty, or the base selector is invalid.
 */
export function extractWithCssSchema(
  html: string,
  schema: CssExtractionSchema
): Record<string, any>[] {
  // Guard the inputs up front so the happy path stays simple and we always
  // return an array (never `undefined`/`null`, never a thrown error).
  if (!html || !schema || !schema.baseSelector) {
    return [];
  }

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    // cheerio is very tolerant, but treat any parse failure as "no results".
    return [];
  }

  const fields = schema.fields ?? [];
  const results: Record<string, any>[] = [];

  let $bases: cheerio.Cheerio<any>;
  try {
    $bases = $(schema.baseSelector);
  } catch {
    // A malformed base selector yields no records rather than an exception.
    return [];
  }

  $bases.each((_index, element) => {
    results.push(buildRecord($, $(element), fields));
  });

  return results;
}

/**
 * Build a single record by resolving every field against `$base`.
 * Used both for top-level base elements and for nested sub-elements.
 */
function buildRecord(
  $: cheerio.CheerioAPI,
  $base: cheerio.Cheerio<any>,
  fields: CssField[]
): Record<string, any> {
  const record: Record<string, any> = {};
  for (const field of fields) {
    record[field.name] = evaluateField($, $base, field);
  }
  return record;
}

/**
 * Resolve a single field relative to `$base`.
 *
 * Any error (e.g. an invalid selector) is swallowed and mapped to the field's
 * empty value: `[]` for collection types, `null` otherwise. This keeps a single
 * bad field from breaking an entire record.
 */
function evaluateField(
  $: cheerio.CheerioAPI,
  $base: cheerio.Cheerio<any>,
  field: CssField
): any {
  try {
    switch (field.type) {
      case 'text': {
        const $match = selectFirst($base, field.selector);
        return $match.length === 0 ? null : $match.text().trim();
      }

      case 'attribute': {
        // Without an attribute name there is nothing to read.
        if (!field.attribute) return null;
        const $match = selectFirst($base, field.selector);
        if ($match.length === 0) return null;
        const value = $match.attr(field.attribute);
        return value === undefined ? null : value;
      }

      case 'html': {
        const $match = selectFirst($base, field.selector);
        // cheerio's `.html()` already returns `null` for an empty element.
        return $match.length === 0 ? null : $match.html();
      }

      case 'number': {
        const $match = selectFirst($base, field.selector);
        return $match.length === 0 ? null : parseNumber($match.text());
      }

      case 'list': {
        const $matches = selectAll($base, field.selector);
        const values: string[] = [];
        $matches.each((_i, el) => {
          values.push($(el).text().trim());
        });
        return values;
      }

      case 'nested': {
        const $match = selectFirst($base, field.selector);
        if ($match.length === 0) return null;
        return buildRecord($, $match, field.fields ?? []);
      }

      case 'nested_list': {
        const $matches = selectAll($base, field.selector);
        const records: Record<string, any>[] = [];
        $matches.each((_i, el) => {
          records.push(buildRecord($, $(el), field.fields ?? []));
        });
        return records;
      }

      default:
        // Unknown field type — be conservative and produce a null value.
        return null;
    }
  } catch {
    // Collection types degrade to an empty array; scalar types to `null`.
    return field.type === 'list' || field.type === 'nested_list' ? [] : null;
  }
}

/**
 * A selector that targets the base element itself rather than a descendant.
 * Both an empty/whitespace selector and `'.'` are treated as "self".
 */
function isSelfSelector(selector: string): boolean {
  const trimmed = (selector ?? '').trim();
  return trimmed === '' || trimmed === '.';
}

/** First match for `selector` within `$base` (or the base element for a self selector). */
function selectFirst(
  $base: cheerio.Cheerio<any>,
  selector: string
): cheerio.Cheerio<any> {
  return isSelfSelector(selector) ? $base.first() : $base.find(selector).first();
}

/** All matches for `selector` within `$base` (or the base element for a self selector). */
function selectAll(
  $base: cheerio.Cheerio<any>,
  selector: string
): cheerio.Cheerio<any> {
  return isSelfSelector(selector) ? $base : $base.find(selector);
}

/**
 * Pull the first numeric value out of a free-form string.
 *
 * Thousands separators (commas) are stripped and currency symbols / surrounding
 * text are ignored, so `"$1,299.99"` becomes `1299.99` and `"Rated 4.5 / 5"`
 * becomes `4.5`. Returns `null` when no number can be parsed (the NaN case).
 */
function parseNumber(text: string): number | null {
  // Remove thousands separators first so "1,299.99" reads as a single token.
  const cleaned = (text ?? '').replace(/,/g, '');
  // Match an optionally-signed integer or decimal anywhere in the string.
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isNaN(value) ? null : value;
}
