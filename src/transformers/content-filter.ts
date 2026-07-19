import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

/**
 * Content filtering ("fit markdown") based on a heuristic pruning algorithm.
 *
 * This is a faithful TypeScript pruning content filter. The
 * goal is to isolate the *main* readable content of an HTML document and discard
 * boilerplate (navigation, footers, ad units, social widgets, etc.) while
 * preserving high-value structures such as headings, tables and code blocks.
 *
 * The module is intentionally self-contained: it takes an HTML string plus a
 * small options object and returns an HTML string (a subset of the input). All
 * pruning happens at the DOM-node level via cheerio and the surviving tree is
 * re-serialized, so tables, links and code are never corrupted by string/regex
 * surgery.
 */

/** Tunable knobs for the pruning pass. All fields are optional. */
export interface PruningOptions {
  /**
   * Minimum composite score (0..1) a leaf block must reach to survive.
   * Blocks below this are pruned unless protected by a preserve rule.
   * Defaults to 0.48.
   */
  threshold?: number;
  /**
   * Minimum number of words a leaf block must contain to survive. Blocks with
   * fewer words have their score forced to 0 (pruned) unless they are a heading,
   * match a preserve rule, or contain kept descendants. Defaults to 2.
   */
  minWords?: number;
  /** Tag names that must always be kept (case-insensitive), never hard-removed. */
  preserveTags?: string[];
  /** Class names that must always be kept (case-insensitive), never hard-removed. */
  preserveClasses?: string[];
}

/** Resolved options with every field populated. */
interface ResolvedOptions {
  threshold: number;
  minWords: number;
  preserveTags: Set<string>;
  preserveClasses: Set<string>;
}

const DEFAULT_THRESHOLD = 0.48;
const DEFAULT_MIN_WORDS = 2;

/**
 * Per-tag structural weight. Semantic/content tags score higher than generic
 * containers. The maximum value (1.5, for <article>) is used to normalise the
 * weight into the [0,1] range.
 */
const TAG_WEIGHTS: Record<string, number> = {
  p: 1.0,
  article: 1.5,
  main: 1.4,
  section: 1.0,
  div: 0.5,
  span: 0.3,
  li: 0.5,
  ul: 0.5,
  ol: 0.5,
  h1: 1.2,
  h2: 1.1,
  h3: 1.0,
  h4: 0.9,
  h5: 0.8,
  h6: 0.7,
  blockquote: 1.0,
  pre: 1.0,
  code: 1.0,
  table: 1.0,
};

/** Maximum tag weight, used to normalise `tag_weight` into [0,1]. */
const MAX_TAG_WEIGHT = 1.5;

/** Default tag weight for tags not present in {@link TAG_WEIGHTS}. */
const DEFAULT_TAG_WEIGHT = 0.5;

/** Tags stripped from the document before scoring (unless preserved). */
const HARD_REMOVE_TAGS = [
  'nav',
  'footer',
  'header',
  'aside',
  'script',
  'style',
  'form',
  'iframe',
  'noscript',
];

/** Tags whose subtrees are always kept intact, regardless of score. */
const ALWAYS_KEEP_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'table',
]);

/**
 * Block-level tags that participate in subtree pruning. Inline tags (a, span,
 * strong, em, img, ...) are treated as part of their parent block and are never
 * pruned individually, which keeps links and inline markup intact.
 */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'aside',
  'header',
  'footer',
  'nav',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'form',
  'fieldset',
  'address',
  'details',
  'summary',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

/**
 * Regex matching class/id tokens that indicate boilerplate. A match drops the
 * element's `class_id_weight` component to 0.
 */
const BOILERPLATE_RE =
  /nav|footer|header|sidebar|ads?|comment|promo|advert|social|share|menu|banner|cookie|popup|modal/i;

/**
 * Ordered list of selectors used to locate the primary content container before
 * the body-wide fallback kicks in.
 */
const CONTAINER_SELECTORS = ['main', 'article', '[role="main"]', '#content', '#main'];

/** Fraction of the full body text the pruned result must retain (safety guard). */
const MIN_RETAINED_TEXT_RATIO = 0.2;

/** Body text length below which the safety guard is skipped. */
const MIN_BODY_TEXT_FOR_GUARD = 200;

/**
 * Resolve user-supplied options, applying defaults and normalising the preserve
 * lists to lower-case sets for fast, case-insensitive lookups.
 */
function resolveOptions(opts?: PruningOptions): ResolvedOptions {
  return {
    threshold: opts?.threshold ?? DEFAULT_THRESHOLD,
    minWords: opts?.minWords ?? DEFAULT_MIN_WORDS,
    preserveTags: new Set((opts?.preserveTags ?? []).map((t) => t.toLowerCase())),
    preserveClasses: new Set((opts?.preserveClasses ?? []).map((c) => c.toLowerCase())),
  };
}

/** Return the lower-cased tag name of a node, or empty string for non-elements. */
function tagNameOf(el: AnyNode | undefined | null): string {
  if (!el) {
    return '';
  }
  const anyEl = el as { type?: string; name?: string; tagName?: string };
  if (anyEl.type !== 'tag' && anyEl.type !== 'script' && anyEl.type !== 'style') {
    // Only element nodes have a meaningful tag name.
    if (!anyEl.name && !anyEl.tagName) {
      return '';
    }
  }
  return (anyEl.name || anyEl.tagName || '').toLowerCase();
}

/** Count whitespace-delimited words in a string. */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/**
 * Determine whether an element is explicitly protected by the caller's
 * preserve rules (matching tag name or any class token).
 */
function isPreserved($: cheerio.CheerioAPI, el: AnyNode, opts: ResolvedOptions): boolean {
  const tag = tagNameOf(el);
  if (tag && opts.preserveTags.has(tag)) {
    return true;
  }
  if (opts.preserveClasses.size === 0) {
    return false;
  }
  const classAttr = $(el).attr('class');
  if (!classAttr) {
    return false;
  }
  return classAttr
    .split(/\s+/)
    .some((cls) => cls && opts.preserveClasses.has(cls.toLowerCase()));
}

/** Whether the element's subtree must always be kept intact (heading/pre/code/table). */
function isAlwaysKeep($: cheerio.CheerioAPI, el: AnyNode, opts: ResolvedOptions): boolean {
  const tag = tagNameOf(el);
  return ALWAYS_KEEP_TAGS.has(tag) || isPreserved($, el, opts);
}

/**
 * Compute a composite content-quality score for a single element node.
 *
 * The score is a weighted blend of five signals, each normalised to [0,1]:
 *
 *   score = text_density*0.4 + link_density*0.2 + tag_weight*0.2
 *         + class_id_weight*0.1 + text_length_norm*0.1
 *
 * where:
 *   - text_density    = textLen / max(1, htmlLen)      (denser text = better)
 *   - link_density    = 1 - linkTextLen / max(1, textLen)
 *                       (HIGH is good: little of the text lives inside links;
 *                        an all-links nav scores ~0)
 *   - tag_weight      = per-tag structural weight, normalised by the max (1.5)
 *   - class_id_weight = 1.0, or 0.0 when class/id matches boilerplate patterns
 *   - text_length_norm= min(1, textLen / 1000)
 *
 * Exported for unit testing. Returns a value clamped to [0,1]; non-element
 * nodes score 0.
 *
 * @param $  A loaded cheerio API instance.
 * @param el The element node to score.
 */
export function computeNodeScore($: cheerio.CheerioAPI, el: AnyNode): number {
  const tag = tagNameOf(el);
  if (!tag) {
    return 0;
  }

  const $el = $(el);
  const text = $el.text();
  const textLen = text.length;
  const html = $.html(el);
  const htmlLen = html.length;
  const linkTextLen = $el.find('a').text().length;

  // 1. Text density: how much of the raw markup is actual text.
  const textDensity = textLen / Math.max(1, htmlLen);

  // 2. Link density: high when little of the text is trapped inside <a> tags.
  const rawLinkDensity = 1 - linkTextLen / Math.max(1, textLen);
  const linkDensity = clamp01(rawLinkDensity);

  // 3. Structural tag weight, normalised into [0,1].
  const tagWeight = (TAG_WEIGHTS[tag] ?? DEFAULT_TAG_WEIGHT) / MAX_TAG_WEIGHT;

  // 4. Class/id weight: penalise obvious boilerplate containers.
  const classAttr = $el.attr('class') ?? '';
  const idAttr = $el.attr('id') ?? '';
  const classIdWeight = BOILERPLATE_RE.test(`${classAttr} ${idAttr}`) ? 0 : 1;

  // 5. Absolute text length, softly normalised.
  const textLengthNorm = Math.min(1, textLen / 1000);

  const score =
    textDensity * 0.4 +
    linkDensity * 0.2 +
    tagWeight * 0.2 +
    classIdWeight * 0.1 +
    textLengthNorm * 0.1;

  return clamp01(score);
}

/** Clamp a number into the [0,1] range. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/**
 * Strip boilerplate tags (nav/footer/script/...) from the document, skipping any
 * element protected by a preserve rule.
 */
function hardRemove($: cheerio.CheerioAPI, opts: ResolvedOptions): void {
  for (const tag of HARD_REMOVE_TAGS) {
    $(tag)
      .toArray()
      .forEach((el) => {
        if (!isPreserved($, el, opts)) {
          $(el).remove();
        }
      });
  }
}

/**
 * Choose the best top-level content container. Prefers semantic containers
 * (main/article/[role=main]/#content/#main) ranked by an aggregate score
 * (quality x text length); falls back to <body> (or the document root).
 */
function selectContainer($: cheerio.CheerioAPI): AnyNode {
  const seen = new Set<AnyNode>();
  let best: AnyNode | null = null;
  let bestAggregate = 0;

  for (const selector of CONTAINER_SELECTORS) {
    $(selector)
      .toArray()
      .forEach((el) => {
        if (seen.has(el)) {
          return;
        }
        seen.add(el);
        const textLen = $(el).text().length;
        const aggregate = computeNodeScore($, el) * textLen;
        if (aggregate > bestAggregate) {
          bestAggregate = aggregate;
          best = el;
        }
      });
  }

  if (best) {
    return best;
  }

  const body = $('body')[0];
  if (body) {
    return body;
  }
  // Fragment with no <body>: fall back to the document root element.
  return $.root()[0] as AnyNode;
}

/**
 * Recursively evaluate a block element, pruning low-value block descendants in
 * place. Returns true if the element (and therefore some content) should be
 * kept, false if the caller should remove it entirely.
 *
 * Rules:
 *  - Headings, pre/code, table and preserved elements keep their whole subtree.
 *  - A block is kept if any of its block descendants are kept (it wraps content).
 *  - An otherwise-leaf block is kept only when it has >= minWords words AND its
 *    composite score meets the threshold; the minWords check is what forces the
 *    score of tiny fragments to zero.
 */
function evaluate($: cheerio.CheerioAPI, el: AnyNode, opts: ResolvedOptions): boolean {
  // Protected subtrees are kept verbatim.
  if (isAlwaysKeep($, el, opts)) {
    return true;
  }

  // Recurse into block-level children only; inline children stay untouched.
  let anyChildKept = false;
  const children = $(el).children().toArray();
  for (const child of children) {
    if (!BLOCK_TAGS.has(tagNameOf(child))) {
      continue;
    }
    if (evaluate($, child, opts)) {
      anyChildKept = true;
    } else {
      $(child).remove();
    }
  }

  // A container holding kept content is always kept (ancestor-of-kept rule).
  if (anyChildKept) {
    return true;
  }

  // Leaf block: honour minWords (forces score to 0) then the score threshold.
  const words = countWords($(el).text());
  if (words < opts.minWords) {
    return false;
  }
  return computeNodeScore($, el) >= opts.threshold;
}

/**
 * Prune the immediate (and nested) block children of the chosen container.
 * The container element itself is never removed.
 */
function pruneContainer($: cheerio.CheerioAPI, container: AnyNode, opts: ResolvedOptions): void {
  const children = $(container).children().toArray();
  for (const child of children) {
    if (!BLOCK_TAGS.has(tagNameOf(child))) {
      continue;
    }
    if (!evaluate($, child, opts)) {
      $(child).remove();
    }
  }
}

/**
 * Extract the main ("fit") content from an HTML document.
 *
 * The document is parsed with cheerio, boilerplate tags are hard-removed, the
 * best content container is selected, and low-value block subtrees within it are
 * pruned. Headings, code blocks, tables and caller-preserved elements always
 * survive. The surviving DOM is re-serialized (never regex-processed).
 *
 * A safety guard prevents over-pruning: if the result retains less than 20% of
 * the cleaned body's text (and the body has meaningful text), the full cleaned
 * body is returned instead.
 *
 * @param html The source HTML.
 * @param opts Optional pruning configuration.
 * @returns    An HTML string containing the extracted main content.
 */
export function pruneToFitHtml(html: string, opts?: PruningOptions): string {
  if (!html || !html.trim()) {
    return '';
  }

  const resolved = resolveOptions(opts);
  const $ = cheerio.load(html);

  // 1. Remove boilerplate tags (keeping any preserved elements).
  hardRemove($, resolved);

  // 2. Capture the cleaned body as a fallback BEFORE any pruning mutates it.
  const bodyEl = $('body')[0];
  const cleanedBodyHtml = bodyEl ? $.html(bodyEl) : $.html();
  const fullBodyTextLen = bodyEl ? $(bodyEl).text().length : $.root().text().length;

  // 3. Pick the container that holds the primary content.
  const container = selectContainer($);

  // 4. Prune low-value block subtrees inside the container.
  pruneContainer($, container, resolved);

  const prunedHtml = $.html(container);
  const prunedTextLen = $(container).text().length;

  // 5. Safety guard: don't return something that dropped almost everything.
  if (
    fullBodyTextLen > MIN_BODY_TEXT_FOR_GUARD &&
    prunedTextLen < fullBodyTextLen * MIN_RETAINED_TEXT_RATIO
  ) {
    return cleanedBodyHtml;
  }

  return prunedHtml;
}
