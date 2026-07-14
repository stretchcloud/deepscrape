import { DesiredField } from './self-heal-core';
import { CssExtractionSchema } from './css-extractor';

/**
 * Pure (I/O-free) core for SiteSpecs — the saved, named, reusable extraction
 * definitions that back the "site -> MCP endpoint" generator. Kept separate from
 * the service so the security-sensitive bits (tool-name validation, URL-template
 * resolution / param injection) are trivially unit-testable.
 */

export type SiteHealth = 'healthy' | 'degraded' | 'unknown';

export interface SiteSpecParam {
  name: string;
  description?: string;
  required?: boolean;
}

export interface SiteSpec {
  id: string;
  name: string;              // MCP tool name — validated slug
  description: string;
  urlTemplate: string;       // may contain {param} placeholders
  params: SiteSpecParam[];
  fields: DesiredField[];
  cssSchema?: CssExtractionSchema; // derived + self-healed selectors (durable copy)
  verify: boolean;           // opt-in to the scheduled verifier
  health: SiteHealth;
  lastVerifiedAt?: number;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * MCP tool names become protocol identifiers, so they are restricted to a safe
 * slug: lowercase letters, digits, and underscores, 1-48 chars.
 */
export const SPEC_NAME_RE = /^[a-z0-9_]{1,48}$/;

export function isValidSpecName(name: unknown): name is string {
  return typeof name === 'string' && SPEC_NAME_RE.test(name);
}

/** Distinct `{placeholder}` names in a URL template, in first-seen order. */
export function templatePlaceholders(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(/\{(\w+)\}/g)) seen.add(m[1]);
  return [...seen];
}

/**
 * Resolve a URL template by substituting `{param}` placeholders with
 * URL-ENCODED values. Encoding is what keeps a param from breaking out of its
 * slot (a value containing `/`, `:`, `?`, `#`, `&`, or `://` becomes inert), so a
 * caller cannot rewrite the host or path structure via a parameter. The resolved
 * URL must still be SSRF-guarded by the caller before any fetch.
 *
 * @throws if any placeholder present in the template has no non-empty value.
 */
export function resolveUrlTemplate(template: string, params: Record<string, unknown> = {}): string {
  let out = template;
  for (const ph of templatePlaceholders(template)) {
    const raw = params?.[ph];
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`missing required URL parameter: ${ph}`);
    }
    out = out.split(`{${ph}}`).join(encodeURIComponent(String(raw)));
  }
  return out;
}

/** Public view of a spec (omits nothing sensitive, but centralizes shaping). */
export function toSpecSummary(s: SiteSpec): Pick<SiteSpec, 'id' | 'name' | 'description' | 'urlTemplate' | 'params' | 'health' | 'lastVerifiedAt' | 'verify'> {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    urlTemplate: s.urlTemplate,
    params: s.params,
    health: s.health,
    lastVerifiedAt: s.lastVerifiedAt,
    verify: s.verify,
  };
}
