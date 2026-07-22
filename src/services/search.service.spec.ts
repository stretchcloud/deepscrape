import {
  parseDuckDuckGoHtml,
  searchWeb,
  runSearch,
  emptyResultHint,
  SearchResult,
} from './search.service';

/**
 * Build a single DuckDuckGo `.result` block. When `href` points at the `/l/?uddg=`
 * redirect wrapper it mirrors the real markup DuckDuckGo serves for organic results.
 */
function resultBlock(href: string, title: string, snippet: string, extraClass = 'web-result'): string {
  return `
    <div class="result results_links results_links_deep ${extraClass}">
      <div class="result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="${href}">${title}</a>
        </h2>
        <a class="result__snippet" href="${href}">${snippet}</a>
      </div>
    </div>
  `;
}

/** Wrap result blocks in the outer container DuckDuckGo returns. */
function page(...blocks: string[]): string {
  return `<!DOCTYPE html><html><body><div id="links" class="results">${blocks.join('\n')}</div></body></html>`;
}

// A real uddg redirect href (protocol-relative, with a trailing tracking param and
// an HTML-encoded ampersand, exactly as DuckDuckGo emits it).
const uddgHref = (realUrl: string) =>
  `//duckduckgo.com/l/?uddg=${encodeURIComponent(realUrl)}&amp;rut=deadbeef`;

describe('parseDuckDuckGoHtml', () => {
  it('extracts title, decoded url and snippet from a uddg redirect result', () => {
    const html = page(
      resultBlock(uddgHref('https://example.com/first'), 'First Result', 'The first snippet text.')
    );

    const results = parseDuckDuckGoHtml(html, 10);

    expect(results).toEqual<SearchResult[]>([
      {
        title: 'First Result',
        url: 'https://example.com/first',
        snippet: 'The first snippet text.',
        position: 1,
      },
    ]);
  });

  it('decodes uddg redirect URLs (including path + query) to the real destination', () => {
    const real = 'https://news.example.org/story?id=42&ref=ddg';
    const html = page(resultBlock(uddgHref(real), 'Encoded URL', 'snippet'));

    const results = parseDuckDuckGoHtml(html, 10);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe(real);
    // The DuckDuckGo redirect wrapper must not leak into the resolved URL.
    expect(results[0].url).not.toContain('duckduckgo.com');
    expect(results[0].url).not.toContain('uddg');
  });

  it('handles direct https hrefs as well as redirect wrappers', () => {
    const html = page(
      resultBlock(uddgHref('https://wrapped.example.com/a'), 'Wrapped', 'via redirect'),
      resultBlock('https://direct.example.net/page', 'Direct', 'no redirect')
    );

    const results = parseDuckDuckGoHtml(html, 10);

    expect(results.map((r) => r.url)).toEqual([
      'https://wrapped.example.com/a',
      'https://direct.example.net/page',
    ]);
  });

  it('deduplicates results by resolved URL, preserving first-seen order', () => {
    const html = page(
      resultBlock(uddgHref('https://example.com/first'), 'First', 'snippet one'),
      resultBlock(uddgHref('https://example.com/second'), 'Second', 'snippet two'),
      // Duplicate of the first result's destination — must be dropped.
      resultBlock(uddgHref('https://example.com/first'), 'First (dupe)', 'snippet one again')
    );

    const results = parseDuckDuckGoHtml(html, 10);

    expect(results.map((r) => r.url)).toEqual([
      'https://example.com/first',
      'https://example.com/second',
    ]);
    // Positions stay contiguous and 1-based after dedup.
    expect(results.map((r) => r.position)).toEqual([1, 2]);
  });

  it('caps the number of results at the provided limit', () => {
    const html = page(
      resultBlock(uddgHref('https://example.com/1'), 'One', 's1'),
      resultBlock(uddgHref('https://example.com/2'), 'Two', 's2'),
      resultBlock(uddgHref('https://example.com/3'), 'Three', 's3')
    );

    const results = parseDuckDuckGoHtml(html, 2);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.url)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
    ]);
  });

  it('skips ad / uddg-less entries that have no decodable destination', () => {
    const html = page(
      // Ad: a duckduckgo.com redirect stub with no `uddg` param.
      resultBlock('//duckduckgo.com/y.js?ad_provider=example&u3=abc', 'Sponsored', 'ad snippet', 'result--ad'),
      resultBlock(uddgHref('https://example.com/organic'), 'Organic', 'organic snippet')
    );

    const results = parseDuckDuckGoHtml(html, 10);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com/organic');
    expect(results.some((r) => r.url.includes('duckduckgo.com'))).toBe(false);
  });

  it('recognises `.web-result` blocks that lack the `.result` class', () => {
    // A container carrying only `web-result` (no `result`) must still be selected.
    const html = `<!DOCTYPE html><html><body>
      <div class="web-result">
        <h2><a class="result__a" href="${uddgHref('https://legacy.example.com/x')}">Legacy</a></h2>
        <a class="result__snippet">legacy snippet</a>
      </div>
    </body></html>`;

    const results = parseDuckDuckGoHtml(html, 10);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ url: 'https://legacy.example.com/x', snippet: 'legacy snippet' });
  });

  it('returns [] for empty HTML without throwing', () => {
    expect(parseDuckDuckGoHtml('', 10)).toEqual([]);
  });

  it('returns [] for garbage / result-less HTML without throwing', () => {
    expect(parseDuckDuckGoHtml('<html><body><p>nothing to see here</p></body></html>', 10)).toEqual([]);
    expect(parseDuckDuckGoHtml('not even html <<<', 10)).toEqual([]);
  });

  it('returns [] when the limit is zero or negative', () => {
    const html = page(resultBlock(uddgHref('https://example.com/first'), 'First', 'snippet'));
    expect(parseDuckDuckGoHtml(html, 0)).toEqual([]);
    expect(parseDuckDuckGoHtml(html, -5)).toEqual([]);
  });
});

describe('searchWeb', () => {
  const originalSearxngUrl = process.env.SEARXNG_URL;

  afterEach(() => {
    if (originalSearxngUrl === undefined) {
      delete process.env.SEARXNG_URL;
    } else {
      process.env.SEARXNG_URL = originalSearxngUrl;
    }
  });

  it('returns [] for an empty query without hitting the network', async () => {
    await expect(searchWeb('   ')).resolves.toEqual([]);
  });

  it('throws when the \'searxng\' provider is selected but SEARXNG_URL is unset', async () => {
    delete process.env.SEARXNG_URL;
    await expect(searchWeb('typescript', { provider: 'searxng' })).rejects.toThrow(/SEARXNG_URL/);
  });
});

describe('runSearch diagnostics (why a search came back empty)', () => {
  const savedSerper = process.env.SERPER_API_KEY;
  const savedSearxng = process.env.SEARXNG_URL;
  afterEach(() => {
    savedSerper === undefined ? delete process.env.SERPER_API_KEY : (process.env.SERPER_API_KEY = savedSerper);
    savedSearxng === undefined ? delete process.env.SEARXNG_URL : (process.env.SEARXNG_URL = savedSearxng);
  });

  it('reports the provider used and no reason for an empty query', async () => {
    delete process.env.SERPER_API_KEY;
    delete process.env.SEARXNG_URL;
    const out = await runSearch('   ');
    expect(out).toEqual({ results: [], provider: 'duckduckgo' });
    expect(out.reason).toBeUndefined();
  });

  it('the duckduckgo empty-hint names the datacenter block and the real fix', () => {
    const hint = emptyResultHint('duckduckgo');
    expect(hint).toMatch(/202/);
    expect(hint).toMatch(/datacenter|server IPs/i);
    expect(hint).toMatch(/SERPER_API_KEY/);
    expect(hint).toMatch(/SEARXNG_URL/);
  });

  it('gives provider-appropriate empty hints for searxng and serper', () => {
    expect(emptyResultHint('searxng')).toMatch(/SearXNG/);
    expect(emptyResultHint('serper')).toMatch(/Serper/);
  });
});
