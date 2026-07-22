/**
 * Small deadline helpers for URL discovery.
 *
 * The map endpoint runs several discovery methods (sitemap, robots, common
 * paths, subdomain sitemaps, browser crawl). Some are slow and unbounded — a
 * site with a huge `docs.` sitemap can take far longer than the request's
 * budget. These helpers let discovery treat `timeoutMs` as a SOFT deadline:
 * return whatever has been found so far instead of throwing everything away.
 *
 * Kept as a pure, dependency-free module so the behaviour is unit-tested without
 * standing up the browser pool / sitemap parser.
 */

/**
 * Resolve to `fallback` if `p` does not settle within `ms`. Never rejects — a
 * rejection from `p` also resolves to `fallback`. The underlying work is not
 * cancelled (there is no cross-cutting abort signal wired through discovery yet),
 * it is just no longer awaited, so a slow method can't block the response.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (ms <= 0) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    // Don't let the timer keep the event loop alive on its own.
    if (typeof timer.unref === 'function') timer.unref();
    p.then((v) => finish(v), () => finish(fallback));
  });
}

export interface Deadline {
  /** Milliseconds left before the deadline (never negative). */
  remaining(): number;
  /** True once the deadline has passed. */
  expired(): boolean;
}

/**
 * A monotonic-ish budget of `totalMs` from "now". `now` is injectable so the
 * arithmetic is testable without real time.
 */
export function makeDeadline(totalMs: number, now: () => number = Date.now): Deadline {
  const end = now() + totalMs;
  return {
    remaining: () => Math.max(0, end - now()),
    expired: () => now() >= end,
  };
}
