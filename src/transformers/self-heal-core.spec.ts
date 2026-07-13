import { siteSignature, schemaCacheKey, validateYield, coerceToSchema, DesiredField } from './self-heal-core';

describe('self-heal-core', () => {
  describe('siteSignature', () => {
    it('normalizes numeric and hex id path segments so same-type pages share a schema', () => {
      expect(siteSignature('https://shop.com/products/12345')).toBe('shop.com/products/:id');
      expect(siteSignature('https://shop.com/products/67890')).toBe('shop.com/products/:id');
      expect(siteSignature('https://shop.com/u/9f8e7d6c5b4a3210/profile')).toBe('shop.com/u/:id/profile');
    });
    it('is stable for the same page type and differs across hosts/paths', () => {
      expect(siteSignature('https://a.com/x/1')).toBe(siteSignature('https://a.com/x/2'));
      expect(siteSignature('https://a.com/x/1')).not.toBe(siteSignature('https://b.com/x/1'));
    });
  });

  describe('schemaCacheKey', () => {
    const fields: DesiredField[] = [{ name: 'title' }, { name: 'price', type: 'number' }];
    it('is identical for same page-type + same fields (order-independent)', () => {
      const k1 = schemaCacheKey('https://shop.com/p/1', fields);
      const k2 = schemaCacheKey('https://shop.com/p/2', [{ name: 'price', type: 'number' }, { name: 'title' }]);
      expect(k1).toBe(k2);
    });
    it('differs when the requested fields differ', () => {
      const k1 = schemaCacheKey('https://shop.com/p/1', fields);
      const k2 = schemaCacheKey('https://shop.com/p/1', [{ name: 'title' }]);
      expect(k1).not.toBe(k2);
    });
  });

  describe('validateYield (breakage detection)', () => {
    it('flags zero records as broken', () => {
      expect(validateYield([], ['title']).healthy).toBe(false);
    });
    it('is healthy when required fields are populated across records', () => {
      const records = [{ title: 'A', price: 1 }, { title: 'B', price: 2 }];
      const y = validateYield(records, ['title', 'price']);
      expect(y.healthy).toBe(true);
      expect(y.populatedRequiredRatio).toBe(1);
      expect(y.recordCount).toBe(2);
    });
    it('flags breakage when a required field goes mostly empty (selector drift)', () => {
      const records = [{ title: 'A', price: null }, { title: 'B', price: null }, { title: 'C', price: null }];
      expect(validateYield(records, ['price']).healthy).toBe(false);
    });
    it('with no required fields, healthy if any field is populated anywhere', () => {
      expect(validateYield([{ a: '', b: 'x' }], []).healthy).toBe(true);
      expect(validateYield([{ a: '', b: null }], []).healthy).toBe(false);
    });
    it('treats empty arrays/objects as unpopulated', () => {
      expect(validateYield([{ tags: [] }], ['tags']).healthy).toBe(false);
      expect(validateYield([{ tags: ['x'] }], ['tags']).healthy).toBe(true);
    });
  });

  describe('coerceToSchema', () => {
    const fields: DesiredField[] = [
      { name: 'title' },
      { name: 'url', type: 'attribute', attribute: 'href' },
      { name: 'price', type: 'number' },
    ];

    it('keeps only requested fields and drops hallucinated ones', () => {
      const raw = {
        baseSelector: 'div.item',
        fields: [
          { name: 'title', selector: 'h2', type: 'text' },
          { name: 'price', selector: '.price', type: 'number' },
          { name: 'ssn', selector: '.secret', type: 'text' }, // not requested -> dropped
        ],
      };
      const schema = coerceToSchema(raw, fields)!;
      expect(schema.baseSelector).toBe('div.item');
      expect(schema.fields.map(f => f.name).sort()).toEqual(['price', 'title']);
    });

    it('defaults a missing baseSelector to body', () => {
      const schema = coerceToSchema({ fields: [{ name: 'title', selector: 'h1', type: 'text' }] }, fields)!;
      expect(schema.baseSelector).toBe('body');
    });

    it('fixes an invalid field type and fills attribute for attribute fields', () => {
      const raw = {
        baseSelector: 'main',
        fields: [
          { name: 'title', selector: 'h1', type: 'bogus' },      // invalid -> 'text'
          { name: 'url', selector: 'a', type: 'attribute' },     // no attribute -> filled from request
        ],
      };
      const schema = coerceToSchema(raw, fields)!;
      const title = schema.fields.find(f => f.name === 'title')!;
      const url = schema.fields.find(f => f.name === 'url')! as any;
      expect(title.type).toBe('text');
      expect(url.type).toBe('attribute');
      expect(url.attribute).toBe('href');
    });

    it('returns null for garbage or when no requested field survives', () => {
      expect(coerceToSchema(null, fields)).toBeNull();
      expect(coerceToSchema('nope', fields)).toBeNull();
      expect(coerceToSchema({ baseSelector: 'div', fields: [{ name: 'unwanted', selector: 'x', type: 'text' }] }, fields)).toBeNull();
    });
  });
});
