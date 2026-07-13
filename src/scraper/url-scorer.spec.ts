import {
  keywordRelevanceScore,
  pathDepthScore,
  freshnessScore,
  compositeUrlScore,
} from './url-scorer';

/**
 * Unit tests for the best-first URL scorers.
 *
 * Every scorer must return a value in [0, 1] and must never throw, even on
 * malformed input, so the crawl frontier can score arbitrary discovered links.
 */
describe('url-scorer', () => {
  /** Assert a numeric score is within the closed unit interval. */
  const expectInUnitInterval = (score: number): void => {
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  };

  describe('keywordRelevanceScore', () => {
    it('returns 1 when every keyword is present', () => {
      const url = 'https://example.com/blog/typescript-web-scraper';
      expect(keywordRelevanceScore(url, ['blog', 'typescript', 'scraper'])).toBe(1);
    });

    it('returns 0 when no keyword is present', () => {
      const url = 'https://example.com/about';
      expect(keywordRelevanceScore(url, ['python', 'django', 'flask'])).toBe(0);
    });

    it('returns the matched fraction for a partial match', () => {
      const url = 'https://example.com/docs/api';
      // "docs" and "api" match; "sdk" and "cli" do not -> 2/4.
      expect(keywordRelevanceScore(url, ['docs', 'api', 'sdk', 'cli'])).toBeCloseTo(0.5, 10);
    });

    it('is case-insensitive by default', () => {
      const url = 'https://Example.com/Blog/Post';
      expect(keywordRelevanceScore(url, ['blog', 'POST'])).toBe(1);
    });

    it('honors caseSensitive matching when requested', () => {
      const url = 'https://example.com/Blog/Post';
      // Lower-case needles do not match the mixed-case URL when case-sensitive.
      expect(keywordRelevanceScore(url, ['blog', 'post'], true)).toBe(0);
      // Exact-case needles do match.
      expect(keywordRelevanceScore(url, ['Blog', 'Post'], true)).toBe(1);
    });

    it('returns a neutral 1 for an empty keyword list', () => {
      expect(keywordRelevanceScore('https://example.com/x', [])).toBe(1);
    });

    it('never leaves the unit interval', () => {
      expectInUnitInterval(keywordRelevanceScore('https://a.com/b', ['b', 'z']));
    });
  });

  describe('pathDepthScore', () => {
    it('peaks at 1 when depth equals the optimal depth', () => {
      // /a/b/c -> depth 3, the default optimum.
      expect(pathDepthScore('https://example.com/a/b/c')).toBe(1);
    });

    it('honors a custom optimal depth', () => {
      expect(pathDepthScore('https://example.com/a', 1)).toBe(1);
      expect(pathDepthScore('https://example.com/a/b', 2)).toBe(1);
    });

    it('decreases as depth moves away from the optimum', () => {
      const atOptimum = pathDepthScore('https://example.com/a/b/c'); // distance 0
      const oneOff = pathDepthScore('https://example.com/a/b'); // distance 1
      const twoOff = pathDepthScore('https://example.com/a'); // distance 2
      const threeOff = pathDepthScore('https://example.com/'); // distance 3
      expect(atOptimum).toBe(1);
      expect(oneOff).toBe(0.5);
      expect(twoOff).toBe(0.333);
      expect(threeOff).toBe(0.25);
      expect(atOptimum).toBeGreaterThan(oneOff);
      expect(oneOff).toBeGreaterThan(twoOff);
      expect(twoOff).toBeGreaterThan(threeOff);
    });

    it('uses 1/(1+distance) beyond the lookup table', () => {
      // /a/b/c/d/e/f/g -> depth 7, distance 4 from default optimum 3.
      expect(pathDepthScore('https://example.com/a/b/c/d/e/f/g')).toBeCloseTo(1 / 5, 10);
    });

    it('ignores a trailing slash', () => {
      expect(pathDepthScore('https://example.com/a/b/c/')).toBe(1);
      expect(pathDepthScore('https://example.com/a/b/c')).toBe(
        pathDepthScore('https://example.com/a/b/c/'),
      );
    });

    it('ignores directory-index filenames', () => {
      // /a/b/index.html counts as depth 2 (index file dropped).
      expect(pathDepthScore('https://example.com/a/b/index.html', 2)).toBe(1);
      expect(pathDepthScore('https://example.com/a/b/index.php', 2)).toBe(1);
      // Case-insensitive on the index filename.
      expect(pathDepthScore('https://example.com/a/b/INDEX.HTML', 2)).toBe(1);
    });

    it('treats the root path as depth 0', () => {
      // depth 0 vs optimum 3 -> distance 3 -> 0.25.
      expect(pathDepthScore('https://example.com')).toBe(0.25);
      expect(pathDepthScore('https://example.com/')).toBe(0.25);
    });

    it('does not throw on a malformed URL', () => {
      let score = -1;
      expect(() => {
        score = pathDepthScore('not a valid url at all');
      }).not.toThrow();
      expectInUnitInterval(score);
    });
  });

  describe('freshnessScore', () => {
    const currentYear = 2026;

    it('scores the current year as maximally fresh', () => {
      expect(freshnessScore('https://example.com/blog/2026/post', currentYear)).toBe(1);
    });

    it('decays as the year gets older', () => {
      expect(freshnessScore('https://example.com/2025/x', currentYear)).toBe(0.9);
      expect(freshnessScore('https://example.com/2024/x', currentYear)).toBe(0.8);
      expect(freshnessScore('https://example.com/2023/x', currentYear)).toBe(0.7);
      expect(freshnessScore('https://example.com/2022/x', currentYear)).toBe(0.6);
      expect(freshnessScore('https://example.com/2021/x', currentYear)).toBe(0.5);
    });

    it('is monotonically non-increasing with age across the lookup range', () => {
      const scores = [2026, 2025, 2024, 2023, 2022, 2021].map((year) =>
        freshnessScore(`https://example.com/${year}/post`, currentYear),
      );
      for (let i = 1; i < scores.length; i += 1) {
        expect(scores[i]).toBeLessThan(scores[i - 1]);
      }
    });

    it('applies linear decay with a 0.1 floor beyond 5 years', () => {
      // 2016 -> diff 10 -> max(0.1, 1 - 1.0) = 0.1.
      expect(freshnessScore('https://example.com/2016/x', currentYear)).toBeCloseTo(0.1, 10);
      // 2000 -> diff 26 -> floored at 0.1.
      expect(freshnessScore('https://example.com/2000/x', currentYear)).toBe(0.1);
      // 2019 -> diff 7 -> 1 - 0.7 = 0.3 (just past the lookup edge).
      expect(freshnessScore('https://example.com/2019/x', currentYear)).toBeCloseTo(0.3, 10);
    });

    it('treats a future year as maximally fresh', () => {
      expect(freshnessScore('https://example.com/2030/preview', currentYear)).toBe(1);
    });

    it('returns a neutral 0.5 when no year is present', () => {
      expect(freshnessScore('https://example.com/blog/latest-post', currentYear)).toBe(0.5);
    });

    it('does not mistake a longer digit run for a year', () => {
      // "120199" contains no standalone 4-digit year.
      expect(freshnessScore('https://example.com/id/120199/item', currentYear)).toBe(0.5);
    });

    it('uses the first year found in the path', () => {
      // First standalone year in the path is 2024.
      expect(freshnessScore('https://example.com/2024/archive/2020', currentYear)).toBe(0.8);
    });

    it('always stays within the unit interval', () => {
      expectInUnitInterval(freshnessScore('https://example.com/1901/old', currentYear));
      expectInUnitInterval(freshnessScore('https://example.com/2099/future', currentYear));
    });
  });

  describe('compositeUrlScore', () => {
    it('runs only the path-depth scorer when no other inputs are given', () => {
      const url = 'https://example.com/a/b/c';
      // Path depth is always active and this URL sits at the default optimum.
      expect(compositeUrlScore(url, {})).toBe(1);
    });

    it('averages the active scorers with equal default weights', () => {
      const url = 'https://example.com/blog/2024/typescript';
      const keyword = keywordRelevanceScore(url, ['blog', 'typescript']); // 1
      const depth = pathDepthScore(url); // depth 3 -> 1
      const fresh = freshnessScore(url, 2026); // 2024 -> 0.8
      const expected = (keyword + depth + fresh) / 3;

      const composite = compositeUrlScore(url, {
        keywords: ['blog', 'typescript'],
        currentYear: 2026,
      });
      expect(composite).toBeCloseTo(expected, 10);
    });

    it('applies per-scorer weights', () => {
      const url = 'https://example.com/blog/2021/post';
      const keyword = keywordRelevanceScore(url, ['blog']); // 1
      const depth = pathDepthScore(url); // depth 3 -> 1
      const fresh = freshnessScore(url, 2026); // 2021 -> 0.5
      const weights = { keyword: 1, pathDepth: 2, freshness: 3 };
      const expected =
        (weights.keyword * keyword + weights.pathDepth * depth + weights.freshness * fresh) /
        (weights.keyword + weights.pathDepth + weights.freshness);

      const composite = compositeUrlScore(url, {
        keywords: ['blog'],
        currentYear: 2026,
        weights,
      });
      expect(composite).toBeCloseTo(expected, 10);
    });

    it('excludes the keyword scorer when keywords are absent or empty', () => {
      const url = 'https://example.com/a/b/2024/x';
      const withEmpty = compositeUrlScore(url, { keywords: [], currentYear: 2026 });
      const withoutKey = compositeUrlScore(url, { currentYear: 2026 });
      const depth = pathDepthScore(url);
      const fresh = freshnessScore(url, 2026);
      const expected = (depth + fresh) / 2;
      expect(withEmpty).toBeCloseTo(expected, 10);
      expect(withoutKey).toBeCloseTo(expected, 10);
    });

    it('excludes the freshness scorer when no currentYear is supplied', () => {
      const url = 'https://example.com/docs/api';
      const keyword = keywordRelevanceScore(url, ['docs', 'api']); // 1
      const depth = pathDepthScore(url); // depth 2 -> 0.5
      const expected = (keyword + depth) / 2;
      expect(compositeUrlScore(url, { keywords: ['docs', 'api'] })).toBeCloseTo(expected, 10);
    });

    it('honors a custom optimal depth for the path-depth term', () => {
      const url = 'https://example.com/a';
      expect(compositeUrlScore(url, { optimalDepth: 1 })).toBe(1);
    });

    it('returns a neutral 0.5 when the effective weight total is zero', () => {
      // Path depth is the only active scorer and it is weighted to zero.
      const score = compositeUrlScore('https://example.com/a/b/c', {
        weights: { pathDepth: 0 },
      });
      expect(score).toBe(0.5);
    });

    it('produces a bounded weighted average', () => {
      const score = compositeUrlScore('https://example.com/blog/2024/post', {
        keywords: ['blog'],
        currentYear: 2026,
      });
      expectInUnitInterval(score);
    });

    it('never throws on a malformed URL', () => {
      let score = -1;
      expect(() => {
        score = compositeUrlScore('::::not a url::::', {
          keywords: ['x'],
          currentYear: 2026,
        });
      }).not.toThrow();
      expectInUnitInterval(score);
    });
  });
});
