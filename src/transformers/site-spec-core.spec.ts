import { isValidSpecName, templatePlaceholders, resolveUrlTemplate, toSpecSummary, SiteSpec } from './site-spec-core';

describe('site-spec-core', () => {
  describe('isValidSpecName', () => {
    it('accepts lowercase slugs with digits and underscores', () => {
      for (const n of ['acme', 'acme_products', 'a', 'get_v2_items', 'x_1_2_3']) {
        expect(isValidSpecName(n)).toBe(true);
      }
    });

    it('rejects uppercase, spaces, hyphens, punctuation, empty, and over-length', () => {
      for (const n of ['Acme', 'acme products', 'acme-products', 'acme.products', 'acme/x', '', 'a'.repeat(49), 'tool!', 'ünïcode']) {
        expect(isValidSpecName(n)).toBe(false);
      }
    });

    it('rejects non-strings', () => {
      expect(isValidSpecName(undefined)).toBe(false);
      expect(isValidSpecName(null)).toBe(false);
      expect(isValidSpecName(42 as unknown)).toBe(false);
    });

    it('accepts exactly 48 chars and rejects 49', () => {
      expect(isValidSpecName('a'.repeat(48))).toBe(true);
      expect(isValidSpecName('a'.repeat(49))).toBe(false);
    });
  });

  describe('templatePlaceholders', () => {
    it('returns distinct placeholders in first-seen order', () => {
      expect(templatePlaceholders('https://x.com/{a}/{b}?q={a}')).toEqual(['a', 'b']);
    });
    it('returns [] when there are none', () => {
      expect(templatePlaceholders('https://x.com/static')).toEqual([]);
    });
    it('ignores malformed braces', () => {
      expect(templatePlaceholders('https://x.com/{unclosed')).toEqual([]);
      expect(templatePlaceholders('https://x.com/{has space}')).toEqual([]); // \w only
    });
  });

  describe('resolveUrlTemplate', () => {
    it('returns the template unchanged when there are no placeholders', () => {
      expect(resolveUrlTemplate('https://x.com/a', { unused: 'y' })).toBe('https://x.com/a');
    });

    it('substitutes a single placeholder', () => {
      expect(resolveUrlTemplate('https://x.com/c/{cat}', { cat: 'shoes' })).toBe('https://x.com/c/shoes');
    });

    it('substitutes multiple and repeated placeholders', () => {
      expect(resolveUrlTemplate('https://x.com/{a}/{b}?q={a}', { a: '1', b: '2' })).toBe('https://x.com/1/2?q=1');
    });

    it('URL-encodes values (spaces, unicode)', () => {
      expect(resolveUrlTemplate('https://x.com/s?q={q}', { q: 'red shoes' })).toBe('https://x.com/s?q=red%20shoes');
      expect(resolveUrlTemplate('https://x.com/s?q={q}', { q: 'café' })).toBe('https://x.com/s?q=caf%C3%A9');
    });

    it('throws when a required placeholder is missing, null, or empty', () => {
      expect(() => resolveUrlTemplate('https://x.com/{cat}', {})).toThrow(/missing required URL parameter: cat/);
      expect(() => resolveUrlTemplate('https://x.com/{cat}', { cat: null })).toThrow(/cat/);
      expect(() => resolveUrlTemplate('https://x.com/{cat}', { cat: '' })).toThrow(/cat/);
    });

    it('coerces non-string values before encoding', () => {
      expect(resolveUrlTemplate('https://x.com/p/{page}', { page: 3 })).toBe('https://x.com/p/3');
    });

    // Security: a parameter must never be able to change the host or path structure.
    describe('injection resistance', () => {
      it('neutralizes a value that tries to escape the path with slashes', () => {
        const out = resolveUrlTemplate('https://x.com/c/{cat}', { cat: '../../admin' });
        expect(out).toBe('https://x.com/c/..%2F..%2Fadmin');
        expect(new URL(out).host).toBe('x.com');
        expect(new URL(out).pathname).toBe('/c/..%2F..%2Fadmin');
      });

      it('neutralizes a value that tries to inject a new host/scheme', () => {
        const out = resolveUrlTemplate('https://x.com/c/{cat}', { cat: 'evil.com/x' });
        expect(new URL(out).host).toBe('x.com'); // still x.com
        const out2 = resolveUrlTemplate('https://x.com/c/{cat}', { cat: 'http://169.254.169.254/' });
        expect(new URL(out2).host).toBe('x.com');
      });

      it('neutralizes query/fragment injection via a value', () => {
        const out = resolveUrlTemplate('https://x.com/s?q={q}', { q: 'a&admin=1#frag' });
        const u = new URL(out);
        expect(u.searchParams.get('q')).toBe('a&admin=1#frag'); // the whole thing is ONE param value
        expect(u.searchParams.get('admin')).toBeNull();
        expect(u.hash).toBe('');
      });
    });
  });

  describe('toSpecSummary', () => {
    it('projects the public fields and omits internals like fields/cssSchema', () => {
      const spec: SiteSpec = {
        id: 'id1', name: 'acme', description: 'd', urlTemplate: 'https://x.com/{c}',
        params: [{ name: 'c', required: true }], fields: [{ name: 'title', required: true }],
        cssSchema: { baseSelector: 'div', fields: [] }, verify: true, health: 'healthy',
        lastVerifiedAt: 123, createdAt: 1, updatedAt: 2,
      };
      const s = toSpecSummary(spec);
      expect(s).toEqual({
        id: 'id1', name: 'acme', description: 'd', urlTemplate: 'https://x.com/{c}',
        params: [{ name: 'c', required: true }], health: 'healthy', lastVerifiedAt: 123, verify: true,
        sessionBound: false,
      });
      expect((s as Record<string, unknown>).fields).toBeUndefined();
      expect((s as Record<string, unknown>).cssSchema).toBeUndefined();
    });

    it('reports sessionBound=true (without leaking the session id) for auth-bound specs', () => {
      const spec: SiteSpec = {
        id: 'id2', name: 'internal', description: '', urlTemplate: 'https://x.com', params: [],
        fields: [{ name: 'x' }], sessionId: 'sess-secret-123', verify: false, health: 'unknown',
        createdAt: 1, updatedAt: 2,
      };
      const s = toSpecSummary(spec);
      expect(s.sessionBound).toBe(true);
      expect(JSON.stringify(s)).not.toContain('sess-secret-123');
    });
  });
});
