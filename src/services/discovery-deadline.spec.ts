import { withDeadline, makeDeadline } from './discovery-deadline';

const slow = <T>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const slowReject = (ms: number) => new Promise((_r, rej) => setTimeout(() => rej(new Error('boom')), ms));

describe('withDeadline', () => {
  it('returns the promise value when it settles in time', async () => {
    await expect(withDeadline(slow('ok', 5), 200, 'fallback')).resolves.toBe('ok');
  });

  it('returns the fallback when the promise is too slow', async () => {
    await expect(withDeadline(slow('ok', 200), 20, 'fallback')).resolves.toBe('fallback');
  });

  it('returns the fallback (never rejects) when the promise rejects', async () => {
    await expect(withDeadline(slowReject(5), 200, 'fallback')).resolves.toBe('fallback');
  });

  it('returns the fallback immediately when ms <= 0', async () => {
    await expect(withDeadline(slow('ok', 5), 0, 'fallback')).resolves.toBe('fallback');
    await expect(withDeadline(slow('ok', 5), -100, 'fallback')).resolves.toBe('fallback');
  });

  it('does not lose the value if it resolves at nearly the same time (first settle wins)', async () => {
    // Whatever wins the race, the result is one of the two valid outcomes and it never throws.
    const r = await withDeadline(slow('ok', 20), 20, 'fallback');
    expect(['ok', 'fallback']).toContain(r);
  });
});

describe('makeDeadline', () => {
  it('reports remaining budget and expiry against an injected clock', () => {
    let t = 1000;
    const d = makeDeadline(500, () => t); // ends at 1500
    expect(d.remaining()).toBe(500);
    expect(d.expired()).toBe(false);
    t = 1300;
    expect(d.remaining()).toBe(200);
    expect(d.expired()).toBe(false);
    t = 1500;
    expect(d.remaining()).toBe(0);
    expect(d.expired()).toBe(true);
    t = 1800;
    expect(d.remaining()).toBe(0); // clamped, never negative
    expect(d.expired()).toBe(true);
  });
});
