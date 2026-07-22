import * as fs from 'fs';
import { buildOpenApiDocument } from './document';
import { renderSpec, SPEC_PATH } from './generate';
import { collectRoutes, routeKeys } from './routes-inventory';

/**
 * Guards against the failure mode this spec was rewritten to fix: swagger.yaml
 * silently drifting from the real API.
 *
 *  1. every route the app registers must be documented
 *  2. nothing may be documented that the app does not serve
 *  3. the committed swagger.yaml must match what the schemas generate
 */

function documentedKeys(): string[] {
  const doc = buildOpenApiDocument();
  const keys: string[] = [];
  for (const [p, item] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(item as Record<string, unknown>)) {
      if (method === 'parameters') continue;
      keys.push(`${method.toUpperCase()} ${p}`);
    }
  }
  return keys.sort();
}

describe('OpenAPI spec', () => {
  const actual = routeKeys(collectRoutes());
  const documented = documentedKeys();

  it('discovers the app routes it is meant to check (sanity)', () => {
    // If the static scanner breaks, every other assertion here becomes vacuous.
    expect(actual.length).toBeGreaterThan(40);
    expect(actual).toContain('POST /api/scrape');
    expect(actual).toContain('GET /health');
  });

  it('documents every endpoint the app registers', () => {
    const missing = actual.filter((k) => !documented.includes(k));
    expect(missing).toEqual([]);
  });

  it('does not document endpoints the app does not serve', () => {
    const extra = documented.filter((k) => !actual.includes(k));
    expect(extra).toEqual([]);
  });

  it('has swagger.yaml committed and in sync with the zod schemas', () => {
    expect(fs.existsSync(SPEC_PATH)).toBe(true);
    const onDisk = fs.readFileSync(SPEC_PATH, 'utf8');
    // If this fails: npm run openapi:generate && commit
    expect(onDisk).toEqual(renderSpec());
  });

  it('derives request options from the zod schemas (regression: stale options)', () => {
    const doc = buildOpenApiDocument() as any;
    const scrapeBody =
      doc.paths['/api/scrape'].post.requestBody.content['application/json'].schema;
    const options = scrapeBody.properties.options.properties;
    // These were accepted by the code but absent from the old hand-written spec.
    for (const opt of ['onlyMainContent', 'fitMarkdown', 'extractorFormat', 'useBrowser', 'stealthMode']) {
      expect(options).toHaveProperty(opt);
    }
  });

  it('requires an API key on /api routes but not on probes', () => {
    const doc = buildOpenApiDocument() as any;
    expect(doc.paths['/api/scrape'].post.security).toBeDefined();
    expect(doc.paths['/health'].get.security).toBeUndefined();
    expect(doc.components.securitySchemes.ApiKeyAuth.name).toBe('X-API-Key');
  });
});
