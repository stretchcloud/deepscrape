import { chunkText, estimateTokens, ChunkOptions } from './chunker';

/** Build a paragraph with a unique leading tag plus `wordCount` filler words. */
function makeParagraph(tag: string, wordCount: number): string {
  const words = Array.from({ length: wordCount }, (_, i) => `${tag}w${i}`);
  return `${tag}: ${words.join(' ')}`;
}

/** Split a chunk back into its paragraph units for overlap assertions. */
function paragraphsOf(chunk: string): string[] {
  return chunk
    .split('\n\n')
    .map(p => p.trim())
    .filter(Boolean);
}

describe('estimateTokens', () => {
  it('returns 0 for empty or whitespace-only input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   ')).toBe(0);
    expect(estimateTokens('\n\t  \n')).toBe(0);
  });

  it('computes ceil(wordCount * 1.3)', () => {
    expect(estimateTokens('word')).toBe(Math.ceil(1 * 1.3)); // 2
    expect(estimateTokens('hello world')).toBe(Math.ceil(2 * 1.3)); // 3
    expect(estimateTokens('one two three')).toBe(Math.ceil(3 * 1.3)); // 4
    expect(estimateTokens('a b c d e')).toBe(Math.ceil(5 * 1.3)); // 7
  });

  it('collapses arbitrary runs of whitespace when counting words', () => {
    expect(estimateTokens('  one   two\tthree\nfour  ')).toBe(Math.ceil(4 * 1.3));
  });

  it('matches words * 1.3 rounded up for many word counts', () => {
    for (let n = 0; n <= 500; n += 7) {
      const text = Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
      expect(estimateTokens(text)).toBe(Math.ceil(n * 1.3));
    }
  });
});

describe('chunkText - trivial inputs', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(chunkText('   \n\n \t ')).toEqual([]);
  });

  it('returns a single trimmed chunk when the whole text fits', () => {
    const text = 'Hello world.\n\nThis is a short document.';
    expect(chunkText(text)).toEqual([text]);
  });

  it('trims surrounding whitespace from the single-chunk result', () => {
    const text = '  Padded content here.  ';
    expect(chunkText(text)).toEqual(['Padded content here.']);
  });

  it('always returns an array', () => {
    expect(Array.isArray(chunkText('anything'))).toBe(true);
  });
});

describe('chunkText - long multi-paragraph documents', () => {
  const opts: ChunkOptions = { maxTokens: 30, overlapRate: 0.1 };
  const paragraphs = Array.from({ length: 12 }, (_, i) => makeParagraph(`P${i}`, 4));
  const text = paragraphs.join('\n\n');

  it('produces multiple chunks', () => {
    const chunks = chunkText(text, opts);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('keeps every chunk within the token budget (approx by estimateTokens)', () => {
    const chunks = chunkText(text, opts);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(opts.maxTokens as number);
    }
  });

  it('preserves all source paragraphs across the chunks', () => {
    const chunks = chunkText(text, opts);
    for (let i = 0; i < paragraphs.length; i++) {
      expect(chunks.some(c => c.includes(`P${i}:`))).toBe(true);
    }
  });

  it('respects a custom (larger) maxTokens', () => {
    const chunks = chunkText(text, { maxTokens: 500, overlapRate: 0.1 });
    // Everything fits comfortably, so we expect a single verbatim chunk.
    expect(chunks).toEqual([text]);
  });
});

describe('chunkText - overlap between consecutive chunks', () => {
  const opts: ChunkOptions = { maxTokens: 30, overlapRate: 0.1 };
  const paragraphs = Array.from({ length: 12 }, (_, i) => makeParagraph(`P${i}`, 4));
  const text = paragraphs.join('\n\n');

  it('shares at least one whole unit between adjacent chunks', () => {
    const chunks = chunkText(text, opts);
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 0; i < chunks.length - 1; i++) {
      const current = new Set(paragraphsOf(chunks[i]));
      const next = paragraphsOf(chunks[i + 1]);
      const shared = next.filter(p => current.has(p));
      expect(shared.length).toBeGreaterThan(0);
    }
  });

  it('does not duplicate units when overlap is disabled', () => {
    const chunks = chunkText(text, { maxTokens: 30, overlapRate: 0 });
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 0; i < chunks.length - 1; i++) {
      const current = new Set(paragraphsOf(chunks[i]));
      const next = paragraphsOf(chunks[i + 1]);
      const shared = next.filter(p => current.has(p));
      expect(shared.length).toBe(0);
    }
  });
});

describe('chunkText - fenced code blocks', () => {
  const fenceBlock = '```js\nfunction foo() {\n  return 42;\n}\nconst x = foo();\n```';
  const text = ['Intro paragraph one two three.', fenceBlock, 'Outro paragraph after code.'].join(
    '\n\n'
  );

  it('never splits a fenced code block across chunks', () => {
    const chunks = chunkText(text, { maxTokens: 20, overlapRate: 0.1 });

    // The full fence block appears intact in exactly one chunk.
    const containing = chunks.filter(c => c.includes(fenceBlock));
    expect(containing).toHaveLength(1);

    // No chunk contains only part of the fence (both markers stay together).
    const withBackticks = chunks.filter(c => c.includes('```'));
    expect(withBackticks).toHaveLength(1);
  });

  it('keeps an oversized fenced block whole rather than hard-splitting it', () => {
    const innerCode = Array.from({ length: 100 }, (_, i) => `code${i}`).join(' ');
    const bigFence = '```\n' + innerCode + '\n```';

    const chunks = chunkText(bigFence, { maxTokens: 20 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('code0');
    expect(chunks[0]).toContain('code99');
  });
});

describe('chunkText - oversized single unit (hard-split)', () => {
  const longParagraph = Array.from({ length: 100 }, (_, i) => `token${i}`).join(' ');

  it('hard-splits a single oversized paragraph into budget-sized chunks', () => {
    const maxTokens = 20;
    const chunks = chunkText(longParagraph, { maxTokens, overlapRate: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it('does not lose any words when hard-splitting', () => {
    const chunks = chunkText(longParagraph, { maxTokens: 20, overlapRate: 0 });
    const combined = chunks.join(' ');
    for (let i = 0; i < 100; i++) {
      expect(combined).toContain(`token${i}`);
    }
  });
});

describe('chunkText - Markdown headings', () => {
  const text = [
    '# Title',
    'Intro sentence under the title.',
    '## Section A',
    makeParagraph('A', 8),
    '## Section B',
    makeParagraph('B', 8),
  ].join('\n\n');

  it('chunks heading-structured content within budget and preserves it', () => {
    const maxTokens = 20;
    const chunks = chunkText(text, { maxTokens, overlapRate: 0.1 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(maxTokens);
    }

    // Headings and their content all survive somewhere in the output.
    for (const marker of ['# Title', '## Section A', '## Section B', 'A:', 'B:']) {
      expect(chunks.some(c => c.includes(marker))).toBe(true);
    }
  });
});

describe('chunkText - option handling', () => {
  const longParagraph = Array.from({ length: 200 }, (_, i) => `t${i}`).join(' ');

  it('falls back to defaults for invalid maxTokens', () => {
    // maxTokens defaults to 2048; 200 short words fit comfortably in one chunk.
    expect(chunkText(longParagraph, { maxTokens: 0 })).toEqual([longParagraph]);
    expect(chunkText(longParagraph, { maxTokens: -5 })).toEqual([longParagraph]);
    expect(chunkText(longParagraph, { maxTokens: NaN })).toEqual([longParagraph]);
  });

  it('treats an invalid overlapRate as the default without throwing', () => {
    const chunks = chunkText(longParagraph, { maxTokens: 40, overlapRate: -1 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(40);
    }
  });

  it('terminates and stays within budget even for an extreme overlapRate', () => {
    const chunks = chunkText(longParagraph, { maxTokens: 40, overlapRate: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(40);
    }
  });

  describe('structure-aware table splitting', () => {
    const header = '| Name | Price | Stock |\n| --- | --- | --- |';
    const rows = Array.from({ length: 40 }, (_, i) => `| Item ${i} | $${i}.99 | ${i * 3} units available |`);
    const bigTable = `${header}\n${rows.join('\n')}`;

    it('splits an oversized table on row boundaries, repeating the header in each piece', () => {
      const chunks = chunkText(bigTable, { maxTokens: 60, overlapRate: 0 });
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Every piece is itself a valid table: it carries the header + separator.
        expect(chunk).toContain('| Name | Price | Stock |');
        expect(chunk).toContain('| --- | --- | --- |');
        // No row is broken mid-line: every non-empty line is a complete pipe row.
        for (const line of chunk.split('\n').filter(Boolean)) {
          expect(line.trim().startsWith('|')).toBe(true);
          expect(line.trim().endsWith('|')).toBe(true);
        }
      }
    });

    it('keeps all table rows across the pieces (no data lost)', () => {
      const chunks = chunkText(bigTable, { maxTokens: 60, overlapRate: 0 });
      const joined = chunks.join('\n');
      for (let i = 0; i < 40; i++) {
        expect(joined).toContain(`| Item ${i} |`);
      }
    });
  });
});
