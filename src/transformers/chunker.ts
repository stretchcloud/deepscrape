/**
 * Token-aware text chunking for LLM extraction over large documents.
 *
 * Large scraped documents frequently exceed a model's context window. This
 * module splits text into overlapping, token-bounded chunks that respect the
 * document's structure: it breaks on paragraph boundaries and Markdown
 * headings, keeps fenced code blocks intact, and carries a small amount of
 * context across chunk boundaries so information isn't lost at the seams.
 *
 * Token counts are approximated (no tokenizer dependency) using a simple
 * words-per-token heuristic, which is accurate enough for budgeting chunks
 * against a model limit while keeping the module dependency-light.
 */

/** Options controlling how {@link chunkText} splits a document. */
export interface ChunkOptions {
  /** Maximum estimated tokens per chunk. Defaults to 2048. */
  maxTokens?: number;
  /**
   * Fraction of `maxTokens` to repeat at the start of each subsequent chunk
   * (carried over from the tail of the previous one). Defaults to 0.1.
   */
  overlapRate?: number;
}

/** Approximate tokens-per-word ratio used by {@link estimateTokens}. */
const TOKENS_PER_WORD = 1.3;

/** Default per-chunk token budget when none is supplied. */
const DEFAULT_MAX_TOKENS = 2048;

/** Default overlap fraction when none is supplied. */
const DEFAULT_OVERLAP_RATE = 0.1;

/**
 * A structural unit of the document (a paragraph, heading block, or a whole
 * fenced code block) together with its cached token estimate.
 */
interface Unit {
  /** The unit's text, with surrounding whitespace trimmed. */
  text: string;
  /** Whether this unit is a fenced code block (atomic — never hard-split). */
  isFence: boolean;
  /** Estimated token count for {@link text}. */
  tokens: number;
}

/**
 * Estimate the number of tokens in a piece of text.
 *
 * Uses the heuristic `ceil(wordCount * 1.3)`, where words are whitespace-
 * delimited. Empty or whitespace-only input yields 0.
 *
 * @param text The text to measure.
 * @returns The estimated token count (a non-negative integer).
 */
export function estimateTokens(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * TOKENS_PER_WORD);
}

/**
 * Split text into token-aware chunks suitable for LLM extraction.
 *
 * The document is first broken into structural units on blank lines
 * (paragraphs) and Markdown headings, while fenced code blocks (``` … ```)
 * are treated as single atomic units and never split internally. Units are
 * then greedily packed into chunks up to `maxTokens`; any single non-fence
 * unit larger than the budget is hard-split on word boundaries. Each chunk
 * after the first begins with roughly `overlap` tokens carried over from the
 * end of the previous chunk so context survives across boundaries.
 *
 * @param text The document text to chunk.
 * @param opts Chunking options (see {@link ChunkOptions}).
 * @returns An array of chunk strings. A document that fits in one chunk
 *   returns a single trimmed chunk; empty/whitespace input returns `[]`.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxTokens = normalizeMaxTokens(opts.maxTokens);
  const overlap = normalizeOverlap(opts.overlapRate, maxTokens);

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  // Fast path: the whole document already fits, so return it verbatim.
  if (estimateTokens(trimmed) <= maxTokens) {
    return [trimmed];
  }

  const units = enforceUnitLimit(splitIntoUnits(trimmed), maxTokens);
  if (units.length === 0) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < units.length) {
    // Greedily pack units until adding the next one would exceed the budget.
    // The first unit of a chunk is always included, even if it alone exceeds
    // the budget (only possible for an oversized, atomic fenced block).
    let end = start;
    let tokens = 0;
    while (end < units.length) {
      const next = units[end].tokens;
      if (end > start && tokens + next > maxTokens) {
        break;
      }
      tokens += next;
      end++;
    }

    chunks.push(
      units
        .slice(start, end)
        .map(u => u.text)
        .join('\n\n')
    );

    if (end >= units.length) {
      break;
    }

    // Carry ~`overlap` tokens of trailing units into the next chunk. We stop
    // before reaching `start` so at least one unit is left behind, which
    // guarantees the window advances and the loop terminates.
    let carriedTokens = 0;
    let carriedUnits = 0;
    let k = end - 1;
    while (k > start && carriedTokens < overlap) {
      carriedTokens += units[k].tokens;
      carriedUnits++;
      k--;
    }

    start = end - carriedUnits;
  }

  return chunks;
}

/**
 * Break text into structural units on blank lines and Markdown headings,
 * keeping fenced code blocks whole. Empty units are discarded.
 */
function splitIntoUnits(text: string): Unit[] {
  const lines = text.split('\n');
  const units: Unit[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = (isFence: boolean): void => {
    const joined = buffer.join('\n').trim();
    if (joined.length > 0) {
      units.push({ text: joined, isFence, tokens: estimateTokens(joined) });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (inFence) {
      buffer.push(line);
      if (isFenceMarker(trimmed)) {
        // Closing fence: emit the whole block as one atomic unit.
        inFence = false;
        flush(true);
      }
      continue;
    }

    if (isFenceMarker(trimmed)) {
      // Opening fence: close any pending paragraph, then start the block.
      flush(false);
      buffer.push(line);
      inFence = true;
      continue;
    }

    if (trimmed === '') {
      // Blank line: paragraph boundary.
      flush(false);
      continue;
    }

    if (isHeadingLine(trimmed)) {
      // A heading begins a new structural unit.
      flush(false);
      buffer.push(line);
      continue;
    }

    buffer.push(line);
  }

  // Emit trailing content, including an unterminated fenced block.
  flush(inFence);

  return units;
}

/**
 * Ensure every unit fits within `maxTokens` by hard-splitting oversized
 * non-fence units on word boundaries. Fenced blocks are left intact even
 * when they exceed the budget, since they must never be split.
 */
function enforceUnitLimit(units: Unit[], maxTokens: number): Unit[] {
  const result: Unit[] = [];

  for (const unit of units) {
    if (unit.isFence || unit.tokens <= maxTokens) {
      result.push(unit);
      continue;
    }

    // An oversized Markdown table is split on ROW boundaries (repeating the
    // header in each piece) so it never breaks mid-row; everything else splits
    // on word boundaries.
    const pieces = isTableBlock(unit.text)
      ? splitTableByRows(unit.text, maxTokens)
      : hardSplit(unit.text, maxTokens);
    for (const piece of pieces) {
      result.push({ text: piece, isFence: false, tokens: estimateTokens(piece) });
    }
  }

  return result;
}

/** True for a block that looks like a Markdown table (pipe rows + a `---` separator). */
function isTableBlock(text: string): boolean {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const pipeLines = lines.filter(l => l.includes('|')).length;
  const hasSeparator = lines.some(l => l.includes('-') && /^\|?[\s:|-]+\|[\s:|-]*$/.test(l));
  return hasSeparator && pipeLines >= 2 && pipeLines / lines.length > 0.6;
}

/**
 * Split an oversized Markdown table into row-bounded pieces, repeating the
 * header + separator row in each piece so every piece is itself a valid table.
 */
function splitTableByRows(text: string, maxTokens: number): string[] {
  const lines = text.split('\n');
  const sepIdx = lines.findIndex(l => l.includes('-') && /^\|?[\s:|-]+\|[\s:|-]*$/.test(l.trim()));
  const header = sepIdx >= 1 ? lines.slice(sepIdx - 1, sepIdx + 1) : [];
  const headerTokens = estimateTokens(header.join('\n'));
  const bodyStart = sepIdx >= 1 ? sepIdx + 1 : 0;

  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = headerTokens;

  for (let i = bodyStart; i < lines.length; i++) {
    const row = lines[i];
    const rowTokens = estimateTokens(row);
    if (current.length > 0 && currentTokens + rowTokens > maxTokens) {
      pieces.push([...header, ...current].join('\n'));
      current = [];
      currentTokens = headerTokens;
    }
    current.push(row);
    currentTokens += rowTokens;
  }
  if (current.length > 0) pieces.push([...header, ...current].join('\n'));

  return pieces.length > 0 ? pieces : [text];
}

/**
 * Split an oversized unit into word-bounded pieces, each estimated at
 * `<= maxTokens` tokens.
 */
function hardSplit(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  // Largest whole-word count whose estimate stays within the budget.
  const maxWords = Math.max(1, Math.floor(maxTokens / TOKENS_PER_WORD));
  const pieces: string[] = [];

  for (let i = 0; i < words.length; i += maxWords) {
    pieces.push(words.slice(i, i + maxWords).join(' '));
  }

  return pieces.length > 0 ? pieces : [text];
}

/** True for a line that opens or closes a fenced code block (```). */
function isFenceMarker(trimmedLine: string): boolean {
  return trimmedLine.startsWith('```');
}

/** True for an ATX Markdown heading line (e.g. `#`, `## Title`). */
function isHeadingLine(trimmedLine: string): boolean {
  return /^#{1,6}(\s|$)/.test(trimmedLine);
}

/** Resolve a valid positive integer token budget, falling back to the default. */
function normalizeMaxTokens(value?: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_TOKENS;
}

/**
 * Resolve the overlap size in tokens. Clamped to `[0, maxTokens - 1]` so an
 * overlap can never consume a whole chunk (which would stall progress).
 */
function normalizeOverlap(rate: number | undefined, maxTokens: number): number {
  const effectiveRate =
    typeof rate === 'number' && Number.isFinite(rate) && rate >= 0
      ? rate
      : DEFAULT_OVERLAP_RATE;

  const overlap = Math.floor(maxTokens * effectiveRate);
  return Math.min(Math.max(overlap, 0), Math.max(maxTokens - 1, 0));
}
