import { incCounter, setGauge, observeHistogram, renderMetrics, resetMetrics } from './metrics.service';

describe('metrics.service', () => {
  beforeEach(() => resetMetrics());

  it('renders a counter with labels and value', () => {
    incCounter('http_requests_total', { method: 'GET', route: '/api/scrape', status: '200' });
    incCounter('http_requests_total', { method: 'GET', route: '/api/scrape', status: '200' });
    const out = renderMetrics();
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toMatch(/http_requests_total\{method="GET",route="\/api\/scrape",status="200"\} 2/);
  });

  it('renders a gauge with the latest value', () => {
    setGauge('browser_pool_active', 3);
    setGauge('browser_pool_active', 5);
    const out = renderMetrics();
    expect(out).toContain('# TYPE browser_pool_active gauge');
    expect(out).toMatch(/browser_pool_active 5/);
  });

  it('populates histogram buckets, sum and count correctly', () => {
    observeHistogram('dur_seconds', 0.03); // <= 0.05
    observeHistogram('dur_seconds', 0.4);  // <= 0.5
    observeHistogram('dur_seconds', 7);    // <= 10
    const out = renderMetrics();
    expect(out).toContain('# TYPE dur_seconds histogram');
    expect(out).toMatch(/dur_seconds_bucket\{le="0.05"\} 1/);
    expect(out).toMatch(/dur_seconds_bucket\{le="0.5"\} 2/);
    expect(out).toMatch(/dur_seconds_bucket\{le="10"\} 3/);
    expect(out).toMatch(/dur_seconds_bucket\{le="\+Inf"\} 3/);
    expect(out).toMatch(/dur_seconds_sum 7.43/);
    expect(out).toMatch(/dur_seconds_count 3/);
  });

  it('escapes quotes in label values', () => {
    incCounter('c', { label: 'a"b' });
    expect(renderMetrics()).toContain('c{label="a\\"b"} 1');
  });
});
