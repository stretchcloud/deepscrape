import { Request, Response, NextFunction } from 'express';

/**
 * Minimal, dependency-free Prometheus metrics registry (text exposition v0.0.4).
 *
 * Supports counters, gauges and histograms with labels. Exposed via
 * `renderMetrics()` at GET /metrics, and populated by `metricsMiddleware` (per
 * HTTP request) plus a few domain helpers (recordScrape, recordCrawlStarted).
 */

type Labels = Record<string, string>;

interface HistogramData {
  buckets: number[];        // upper bounds
  counts: number[];         // cumulative counts per bucket (+Inf implied)
  sum: number;
  count: number;
}

const DEFAULT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, HistogramData>();
const histogramBaseName = new Map<string, string>(); // series key -> metric name
const counterBaseName = new Map<string, string>();
const gaugeBaseName = new Map<string, string>();

/** Serialize labels to a stable, sorted key like {a="1",b="2"}. */
function labelKey(labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const parts = Object.keys(labels)
    .sort()
    .map(k => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

function escapeLabelValue(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function seriesKey(name: string, labels?: Labels): string {
  return `${name}${labelKey(labels)}`;
}

export function incCounter(name: string, labels?: Labels, value = 1): void {
  const key = seriesKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + value);
  counterBaseName.set(key, name);
}

export function setGauge(name: string, value: number, labels?: Labels): void {
  const key = seriesKey(name, labels);
  gauges.set(key, value);
  gaugeBaseName.set(key, name);
}

export function observeHistogram(name: string, value: number, labels?: Labels): void {
  const key = seriesKey(name, labels);
  let h = histograms.get(key);
  if (!h) {
    h = { buckets: DEFAULT_BUCKETS, counts: new Array(DEFAULT_BUCKETS.length).fill(0), sum: 0, count: 0 };
    histograms.set(key, h);
    histogramBaseName.set(key, name);
  }
  h.sum += value;
  h.count += 1;
  for (let i = 0; i < h.buckets.length; i++) {
    if (value <= h.buckets[i]) h.counts[i] += 1;
  }
}

/** Render all registered metrics in Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [];

  const counterNames = new Set([...counterBaseName.values()]);
  for (const name of counterNames) {
    lines.push(`# TYPE ${name} counter`);
    for (const [key, value] of counters) {
      if (counterBaseName.get(key) === name) lines.push(`${key} ${value}`);
    }
  }

  const gaugeNames = new Set([...gaugeBaseName.values()]);
  for (const name of gaugeNames) {
    lines.push(`# TYPE ${name} gauge`);
    for (const [key, value] of gauges) {
      if (gaugeBaseName.get(key) === name) lines.push(`${key} ${value}`);
    }
  }

  const histNames = new Set([...histogramBaseName.values()]);
  for (const name of histNames) {
    lines.push(`# TYPE ${name} histogram`);
    for (const [key, h] of histograms) {
      if (histogramBaseName.get(key) !== name) continue;
      // key is like name{labels}; split base + labels to inject `le`.
      const labelsPart = key.slice(name.length); // '' or '{...}'
      const withLe = (le: string) => {
        if (labelsPart === '') return `${name}_bucket{le="${le}"}`;
        return `${name}_bucket{${labelsPart.slice(1, -1)},le="${le}"}`;
      };
      for (let i = 0; i < h.buckets.length; i++) {
        lines.push(`${withLe(String(h.buckets[i]))} ${h.counts[i]}`);
      }
      lines.push(`${withLe('+Inf')} ${h.count}`);
      lines.push(`${name}_sum${labelsPart} ${h.sum}`);
      lines.push(`${name}_count${labelsPart} ${h.count}`);
    }
  }

  return lines.join('\n') + '\n';
}

/** Derive a low-cardinality route label (avoid raw URLs with ids). */
function routeLabel(req: Request): string {
  const mounted = (req.baseUrl || '') + ((req.route && req.route.path) || '');
  if (mounted && mounted !== '/') return mounted;
  const segs = (req.path || '/').split('/').filter(Boolean).slice(0, 2);
  return '/' + segs.join('/');
}

/** Express middleware recording request count + duration per route. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
    incCounter('http_requests_total', labels);
    observeHistogram('http_request_duration_seconds', durationSec, { method: req.method, route: routeLabel(req) });
  });
  next();
}

/** Domain helper: record a scrape outcome + duration. */
export function recordScrape(status: 'success' | 'error', durationMs: number): void {
  incCounter('deepscrape_scrapes_total', { status });
  observeHistogram('deepscrape_scrape_duration_seconds', durationMs / 1000);
}

/** Domain helper: a crawl was started. */
export function recordCrawlStarted(): void {
  incCounter('deepscrape_crawls_started_total');
}

/** Test/maintenance helper: clear all metrics. */
export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  histograms.clear();
  counterBaseName.clear();
  gaugeBaseName.clear();
  histogramBaseName.clear();
}
