import * as fs from 'fs';
import * as path from 'path';

/**
 * Statically discovers every route the Express app actually registers, by
 * reading `src/index.ts` (mount points) and `src/api/routes/*.ts` (route
 * definitions).
 *
 * It parses source text rather than importing the modules on purpose: importing
 * a route file pulls in controllers -> services -> Redis, BullMQ and the browser
 * pool, all of which open handles at import time.
 *
 * The OpenAPI test compares this inventory against the generated spec, so a new
 * endpoint that nobody documented fails the build.
 */

export interface RouteEntry {
  method: string;
  /** OpenAPI-style path, e.g. /api/crawl/{jobId} */
  path: string;
}

const SRC = path.resolve(__dirname, '../../');
const ROUTES_DIR = path.join(SRC, 'api', 'routes');
const INDEX_FILE = path.join(SRC, 'index.ts');

const METHODS = 'get|post|put|delete|patch';

/** Express ":param" -> OpenAPI "{param}" */
function toOpenApiPath(p: string): string {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function joinPath(mount: string, sub: string): string {
  const joined = `${mount.replace(/\/+$/, '')}/${sub.replace(/^\/+/, '')}`;
  const cleaned = joined.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return cleaned === '' ? '/' : cleaned;
}

/**
 * Map a local identifier used in `app.use(...)` to the (file, routerVariable)
 * it refers to. Default imports resolve to the file's `router` const; named
 * imports keep their own name.
 */
function parseRouteImports(indexSrc: string): Map<string, { file: string; varName: string }> {
  const map = new Map<string, { file: string; varName: string }>();

  // import x from './api/routes/foo';
  for (const m of indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/api\/routes\/([\w.-]+)'/g)) {
    map.set(m[1], { file: `${m[2]}.ts`, varName: 'router' });
  }
  // import { a, b } from './api/routes/foo';
  for (const m of indexSrc.matchAll(/import\s+\{([^}]+)\}\s+from\s+'\.\/api\/routes\/([\w.-]+)'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()!.trim();
      if (name) map.set(name, { file: `${m[2]}.ts`, varName: name });
    }
  }
  return map;
}

/** Collect `<routerVar>.<method>('<path>')` definitions from one route file. */
function parseRouteFile(fileSrc: string): Array<{ varName: string; method: string; sub: string }> {
  const out: Array<{ varName: string; method: string; sub: string }> = [];
  const re = new RegExp(`(\\w+)\\s*\\.\\s*(${METHODS})\\s*\\(\\s*(?:\\r?\\n\\s*)?['"\`]([^'"\`]*)['"\`]`, 'g');
  for (const m of fileSrc.matchAll(re)) {
    out.push({ varName: m[1], method: m[2].toLowerCase(), sub: m[3] });
  }
  return out;
}

export function collectRoutes(): RouteEntry[] {
  const indexSrc = fs.readFileSync(INDEX_FILE, 'utf8');
  const importMap = parseRouteImports(indexSrc);
  const entries: RouteEntry[] = [];

  // Routes registered directly on the app (health, metrics, ...)
  const appRe = new RegExp(`app\\s*\\.\\s*(${METHODS})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
  for (const m of indexSrc.matchAll(appRe)) {
    entries.push({ method: m[1].toLowerCase(), path: toOpenApiPath(m[2]) });
  }

  // Mounted routers: app.use('<mount>', <identifier>)
  const fileCache = new Map<string, ReturnType<typeof parseRouteFile>>();
  for (const m of indexSrc.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)) {
    const [, mount, ident] = m;
    const target = importMap.get(ident);
    if (!target) continue; // middleware (rate limiter, quota) — not a router

    const filePath = path.join(ROUTES_DIR, target.file);
    if (!fs.existsSync(filePath)) continue;

    if (!fileCache.has(target.file)) {
      fileCache.set(target.file, parseRouteFile(fs.readFileSync(filePath, 'utf8')));
    }
    for (const r of fileCache.get(target.file)!) {
      if (r.varName !== target.varName) continue;
      entries.push({ method: r.method, path: toOpenApiPath(joinPath(mount, r.sub)) });
    }
  }

  // De-duplicate and sort for stable comparison
  const seen = new Set<string>();
  return entries
    .filter((e) => {
      const k = `${e.method} ${e.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

/** "GET /api/crawl/{jobId}" keys for set comparison. */
export function routeKeys(entries: RouteEntry[]): string[] {
  return entries.map((e) => `${e.method.toUpperCase()} ${e.path}`).sort();
}
