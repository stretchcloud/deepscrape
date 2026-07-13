/**
 * Deterministic, LLM-free confidence scoring for extracted data.
 *
 * LLM extraction's two silent failure modes are *hallucination* (a field value the
 * model invented that isn't on the page) and *omission* (a field it left null/empty).
 * Neither is caught by schema validation. This scorer grades each field by whether
 * its value is actually *grounded* in the source content — present verbatim or by
 * strong token overlap — turning "looks fine" output into an honest confidence
 * signal callers can threshold on. It costs nothing (no extra model call).
 */

export interface FieldConfidence {
  present: boolean;   // the model returned a non-empty value
  grounded: boolean;  // the value is substantiated by the source text
  confidence: number; // 0..1
}

export interface ConfidenceReport {
  overall: number;                          // 0..1 mean across scored fields
  fields: Record<string, FieldConfidence>;  // per top-level field
  suspect: string[];                        // fields present but not grounded (possible hallucination)
  missing: string[];                        // fields absent/empty (omission)
}

const HIGH = 0.9;   // present + grounded
const LOW = 0.3;    // present but not grounded (hallucination-suspect)

/** Normalize free text for comparison: lowercase, strip punctuation, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPopulated(v: any): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** Is a scalar value substantiated by the (normalized) source text? */
function groundedScalar(value: string | number, normSource: string): boolean {
  if (typeof value === 'number') {
    // Compare the digit run so "1299.99" matches "$1,299.99" in the source.
    const digits = String(value).replace(/[^0-9]/g, '');
    return digits.length === 0 ? true : normSource.replace(/[^0-9]/g, '').includes(digits);
  }
  const nv = normalize(String(value));
  if (nv.length < 2) return true; // too short to judge — don't penalize
  if (normSource.includes(nv)) return true;
  // Token-overlap fallback: most significant words of the value appear in source.
  const words = nv.split(' ').filter(w => w.length > 2);
  if (words.length === 0) return true;
  const hit = words.filter(w => normSource.includes(w)).length;
  return hit / words.length >= 0.6;
}

function scoreValue(value: any, normSource: string): FieldConfidence {
  const present = isPopulated(value);
  if (!present) return { present: false, grounded: false, confidence: 0 };

  if (Array.isArray(value)) {
    const scalars = value.filter(v => typeof v === 'string' || typeof v === 'number');
    if (scalars.length === 0) return { present: true, grounded: true, confidence: HIGH };
    const groundedCount = scalars.filter(v => groundedScalar(v, normSource)).length;
    const frac = groundedCount / scalars.length;
    return { present: true, grounded: frac >= 0.6, confidence: LOW + (HIGH - LOW) * frac };
  }

  if (typeof value === 'object') {
    // Nested object: grounded if any leaf is grounded (shallow check).
    const leaves = Object.values(value).filter(v => typeof v === 'string' || typeof v === 'number');
    const grounded = leaves.length === 0 || leaves.some(v => groundedScalar(v as any, normSource));
    return { present: true, grounded, confidence: grounded ? HIGH : LOW };
  }

  const grounded = groundedScalar(value, normSource);
  return { present: true, grounded, confidence: grounded ? HIGH : LOW };
}

/**
 * Score extracted `data` (object or array of objects) against the `sourceContent`
 * it was extracted from. Returns per-field confidence plus suspect/missing lists.
 */
export function scoreExtraction(data: any, sourceContent: string): ConfidenceReport {
  const normSource = normalize(sourceContent || '');

  // For an array of records, score the first record's fields (representative);
  // arrays of scalars/empty collapse to an empty report.
  let record: Record<string, any> | null = null;
  if (Array.isArray(data)) {
    record = data.find(d => d && typeof d === 'object' && !Array.isArray(d)) ?? null;
  } else if (data && typeof data === 'object') {
    record = data;
  }

  if (!record) {
    return { overall: 0, fields: {}, suspect: [], missing: [] };
  }

  const fields: Record<string, FieldConfidence> = {};
  const suspect: string[] = [];
  const missing: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    const fc = scoreValue(value, normSource);
    fields[key] = fc;
    if (!fc.present) missing.push(key);
    else if (!fc.grounded) suspect.push(key);
  }

  const scores = Object.values(fields).map(f => f.confidence);
  const overall = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return { overall: Number(overall.toFixed(3)), fields, suspect, missing };
}
