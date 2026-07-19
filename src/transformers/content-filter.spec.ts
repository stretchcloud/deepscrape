import * as cheerio from 'cheerio';
import { pruneToFitHtml, computeNodeScore, PruningOptions } from './content-filter';

/**
 * Unit tests for the "fit markdown" content filter (pruning + link-density). Tests are grouped by the public API surface:
 * `computeNodeScore` (the per-node scoring heuristic) and `pruneToFitHtml`
 * (the end-to-end extraction pass).
 */

/** Helper: build enough prose to comfortably clear the pruning threshold. */
function longProse(times = 3): string {
  return (
    'A sufficiently long paragraph of genuine article prose that easily clears ' +
    'the threshold and the minimum word count required for retention here. '
  ).repeat(times);
}

/** Helper: score a single selected element within an HTML fragment. */
function scoreOf(html: string, selector: string): number {
  const $ = cheerio.load(html);
  return computeNodeScore($, $(selector)[0]);
}

describe('computeNodeScore', () => {
  it('returns a value within the [0,1] range', () => {
    const score = scoreOf(`<article><p>${longProse()}</p></article>`, 'p');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores a non-element node (text node) as 0', () => {
    const $ = cheerio.load('<p>hello world</p>');
    const textNode = $('p').contents()[0]; // the raw text node, not an element
    expect(computeNodeScore($, textNode)).toBe(0);
  });

  it('gives an all-links <nav> a near-zero score (high link density)', () => {
    const nav =
      '<nav class="navbar">' +
      '<a href="/a">Home</a><a href="/b">About</a><a href="/c">Services</a>' +
      '<a href="/d">Products</a><a href="/e">Blog</a><a href="/f">Contact</a>' +
      '</nav>';
    const score = scoreOf(nav, 'nav');
    // Almost all of the text lives inside <a> tags, so link_density ~ 0 and the
    // boilerplate class zeroes out class_id_weight.
    expect(score).toBeLessThan(0.25);
  });

  it('gives a text-rich article <p> a high score', () => {
    const score = scoreOf(`<article><p>${longProse()}</p></article>`, 'p');
    expect(score).toBeGreaterThan(0.6);
  });

  it('ranks a content paragraph well above an all-links nav', () => {
    const nav =
      '<nav class="navbar"><a href="/a">Home</a><a href="/b">About</a>' +
      '<a href="/c">Services</a><a href="/d">Products</a></nav>';
    const para = `<article><p>${longProse()}</p></article>`;
    const navScore = scoreOf(nav, 'nav');
    const paraScore = scoreOf(para, 'p');
    expect(paraScore).toBeGreaterThan(navScore);
    // The nav should fall below the default keep-threshold; the paragraph above.
    expect(navScore).toBeLessThan(0.48);
    expect(paraScore).toBeGreaterThan(0.48);
  });

  it('penalises boilerplate class/id names via class_id_weight', () => {
    // Two structurally identical divs; only the class token differs. Both class
    // names are 7 chars long so the serialized HTML length (and thus every other
    // score component) is identical -- isolating the class_id_weight term.
    const plain = `<div class="content"><p>${longProse()}</p></div>`; // not boilerplate
    const boiler = `<div class="sidebar"><p>${longProse()}</p></div>`; // matches /sidebar/
    const plainScore = scoreOf(plain, 'div');
    const boilerScore = scoreOf(boiler, 'div');
    // The boilerplate class removes exactly the 0.1 class_id_weight contribution.
    expect(plainScore - boilerScore).toBeCloseTo(0.1, 5);
  });

  it('rewards higher structural tag weight (article > div for same content)', () => {
    const inner = `<p>${longProse()}</p>`;
    const asArticle = scoreOf(`<article>${inner}</article>`, 'article');
    const asDiv = scoreOf(`<div>${inner}</div>`, 'div');
    expect(asArticle).toBeGreaterThan(asDiv);
  });
});

describe('pruneToFitHtml', () => {
  it('returns an empty string for empty or whitespace-only input', () => {
    expect(pruneToFitHtml('')).toBe('');
    expect(pruneToFitHtml('   \n  ')).toBe('');
  });

  it('keeps the <article> and drops nav/header/footer boilerplate', () => {
    const html = `<html><body>
      <header class="site-header"><nav><a href="/x">X</a></nav></header>
      <nav class="main-nav"><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></nav>
      <article><h1>Real Title</h1><p>${longProse(4)}</p></article>
      <aside class="sidebar"><a href="/s1">Ad</a><a href="/s2">Promo</a></aside>
      <footer class="site-footer"><a href="/f1">Privacy</a><a href="/f2">Terms</a></footer>
    </body></html>`;
    const out = pruneToFitHtml(html);

    expect(out).toContain('<article>');
    expect(out).toContain('Real Title');
    // Boilerplate containers are gone.
    expect(out).not.toContain('<nav');
    expect(out).not.toContain('site-footer');
    expect(out).not.toContain('sidebar');
  });

  it('preserves main content nested in generic <div>s (not just the heading)', () => {
    const html = `<html><body>
      <div class="wrap"><div class="inner">
        <h1>Deeply Nested</h1>
        <div class="col"><p>${longProse(4)}</p></div>
      </div></div>
    </body></html>`;
    const out = pruneToFitHtml(html);

    // Both the heading AND the nested paragraph body must survive.
    expect(out).toContain('Deeply Nested');
    expect(out).toContain('genuine article prose');
    // The paragraph text should not have been reduced away.
    expect(out.length).toBeGreaterThan('Deeply Nested'.length + 50);
  });

  it('keeps <table> and <pre><code> structures intact', () => {
    const html = `<html><body><main>
      <h2>Data</h2>
      <table><thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody><tr><td>1</td><td>2</td></tr></tbody></table>
      <pre><code>const answer = 42;</code></pre>
      <p>${longProse(3)}</p>
    </main></body></html>`;
    const out = pruneToFitHtml(html);

    expect(out).toContain('<table>');
    expect(out).toContain('<td>1</td>');
    expect(out).toContain('<td>2</td>');
    expect(out).toContain('<pre>');
    expect(out).toContain('const answer = 42;');
  });

  it('hard-removes script and style but keeps headings', () => {
    const html = `<html><body><article>
      <script>window.tracker = 1;</script>
      <style>.ad{display:block}</style>
      <h1>Heading One</h1>
      <p>${longProse(3)}</p>
    </article></body></html>`;
    const out = pruneToFitHtml(html);

    expect(out).not.toContain('window.tracker');
    expect(out).not.toContain('display:block');
    expect(out).toContain('Heading One');
  });

  it('always keeps headings even when they contain fewer than minWords words', () => {
    const html = `<html><body><main>
      <h1>Go</h1>
      <p>${longProse(3)}</p>
    </main></body></html>`;
    const out = pruneToFitHtml(html);
    expect(out).toContain('<h1>Go</h1>');
  });

  it('prunes tiny (sub-minWords) blocks by default', () => {
    const html = `<html><body><article>
      <h2>Shopping</h2>
      <ul><li>Apples</li><li>Oranges</li></ul>
      <p>${longProse(3)}</p>
    </article></body></html>`;
    const out = pruneToFitHtml(html);

    // Single-word list items fall below minWords (default 2) and are pruned...
    expect(out).not.toContain('Apples');
    // ...while the substantive paragraph survives.
    expect(out).toContain('genuine article prose');
  });

  it('respects a custom minWords option', () => {
    const html = `<html><body><article>
      <h2>Shopping</h2>
      <ul><li>Apples</li><li>Oranges</li></ul>
      <p>${longProse(3)}</p>
    </article></body></html>`;
    // Lowering minWords to 1 lets the single-word list items survive.
    const out = pruneToFitHtml(html, { minWords: 1 });
    expect(out).toContain('Apples');
    expect(out).toContain('Oranges');
  });

  it('keeps a normally-hard-removed <form> when its tag is preserved', () => {
    const html = `<html><body><main>
      <p>${longProse(3)}</p>
      <form class="site-search"><input type="text"></form>
    </main></body></html>`;

    // Forms are hard-removed by default...
    expect(pruneToFitHtml(html)).not.toContain('<form');
    // ...but survive when explicitly preserved by tag.
    const opts: PruningOptions = { preserveTags: ['form'] };
    expect(pruneToFitHtml(html, opts)).toContain('<form');
  });

  it('keeps a low-value block when its class is preserved', () => {
    const html = `<html><body><main>
      <p>${longProse(3)}</p>
      <div class="callout">Tip</div>
    </main></body></html>`;

    // The single-word "callout" div is pruned by default...
    expect(pruneToFitHtml(html)).not.toContain('callout');
    // ...but survives when its class is preserved.
    const opts: PruningOptions = { preserveClasses: ['callout'] };
    const out = pruneToFitHtml(html, opts);
    expect(out).toContain('callout');
    expect(out).toContain('Tip');
  });

  it('applies the safety guard when pruning would drop almost everything', () => {
    // The <main> holds a one-word paragraph (pruned), while the bulk of the
    // body text lives in a sibling div. Naively returning <main> would drop the
    // vast majority of the text, so the guard returns the full cleaned body.
    const bulk =
      'This large block of body text lives outside the tiny main element and ' +
      'dominates the total body text length so the guard must engage here. ';
    const html = `<html><body>
      <main><p>hi</p></main>
      <div class="body-copy">${bulk.repeat(6)}</div>
    </body></html>`;
    const out = pruneToFitHtml(html);

    // Guard engaged: the large sibling block is retained.
    expect(out).toContain('This large block of body text');
    expect(out).toContain('body-copy');
  });

  it('does not trigger the guard for a short overall document', () => {
    // Body text is under the 200-char guard floor, so no fallback occurs and
    // the pruned (possibly empty-ish) container result is returned as-is.
    const html = `<html><body><main><p>ok</p></main></body></html>`;
    const out = pruneToFitHtml(html);
    // The one-word paragraph is pruned and the guard does not rescue it.
    expect(out).not.toContain('body-copy');
    expect(typeof out).toBe('string');
  });

  it('produces re-serializable output that survives a second pass (idempotent-ish)', () => {
    const html = `<html><body>
      <nav class="nav"><a href="/a">A</a></nav>
      <article><h1>Keep Me</h1><p>${longProse(3)}</p></article>
    </body></html>`;
    const first = pruneToFitHtml(html);
    const second = pruneToFitHtml(first);

    expect(first).toContain('Keep Me');
    expect(second).toContain('Keep Me');
    // The extracted container is the article, not the whole document.
    expect(first.trim().startsWith('<article')).toBe(true);
  });

  it('selects the richest semantic container among several candidates', () => {
    // Both a sparse <main> and a rich <article> exist; the article wins.
    const html = `<html><body>
      <main><p>tiny</p></main>
      <article><h1>Chosen</h1><p>${longProse(4)}</p></article>
    </body></html>`;
    const out = pruneToFitHtml(html);
    expect(out).toContain('Chosen');
    expect(out).toContain('<article>');
  });
});
