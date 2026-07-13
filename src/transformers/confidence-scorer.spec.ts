import { scoreExtraction } from './confidence-scorer';

describe('confidence-scorer', () => {
  const source = 'The Acme Widget Pro costs $1,299.99. It is made by Acme Corporation and ships worldwide. Tags: durable, portable.';

  it('marks a grounded string field as high-confidence and not suspect', () => {
    const r = scoreExtraction({ name: 'Acme Widget Pro' }, source);
    expect(r.fields.name.present).toBe(true);
    expect(r.fields.name.grounded).toBe(true);
    expect(r.fields.name.confidence).toBeGreaterThan(0.8);
    expect(r.suspect).toHaveLength(0);
  });

  it('flags a hallucinated field (not in source) as suspect with low confidence', () => {
    const r = scoreExtraction({ name: 'Globex Turbo Encabulator 9000' }, source);
    expect(r.fields.name.present).toBe(true);
    expect(r.fields.name.grounded).toBe(false);
    expect(r.fields.name.confidence).toBeLessThan(0.5);
    expect(r.suspect).toContain('name');
  });

  it('records missing/empty fields as omissions with zero confidence', () => {
    const r = scoreExtraction({ name: 'Acme Widget Pro', vendor: null, notes: '' }, source);
    expect(r.missing).toEqual(expect.arrayContaining(['vendor', 'notes']));
    expect(r.fields.vendor.confidence).toBe(0);
  });

  it('grounds a number even when the source reformats it with currency/commas', () => {
    const r = scoreExtraction({ price: 1299.99 }, source);
    expect(r.fields.price.grounded).toBe(true);
  });

  it('scores arrays by the fraction of grounded items', () => {
    const grounded = scoreExtraction({ tags: ['durable', 'portable'] }, source);
    expect(grounded.fields.tags.grounded).toBe(true);
    const partly = scoreExtraction({ tags: ['durable', 'fictional', 'imaginary'] }, source);
    expect(partly.fields.tags.confidence).toBeLessThan(grounded.fields.tags.confidence);
  });

  it('computes an overall mean and handles an array of records (first record)', () => {
    const r = scoreExtraction([{ name: 'Acme Widget Pro', vendor: 'Acme Corporation' }], source);
    expect(r.fields.name.grounded).toBe(true);
    expect(r.fields.vendor.grounded).toBe(true);
    expect(r.overall).toBeGreaterThan(0.8);
  });

  it('returns an empty report for non-object data', () => {
    expect(scoreExtraction('just a string', source).overall).toBe(0);
    expect(scoreExtraction(42, source).fields).toEqual({});
  });
});
