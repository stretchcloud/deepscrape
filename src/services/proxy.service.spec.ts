import { ProxyService } from './proxy.service';

/**
 * ProxyService is a singleton that reads config from env via load(). Each test
 * sets the relevant env vars and reloads, then restores in afterEach.
 */
describe('ProxyService', () => {
  const svc = ProxyService.getInstance();

  afterEach(() => {
    delete process.env.PROXY_LIST;
    delete process.env.PROXY_ENABLED;
    delete process.env.PROXY_USERNAME;
    delete process.env.PROXY_PASSWORD;
    svc.load();
  });

  it('parses comma-separated proxies with embedded and shared credentials', () => {
    process.env.PROXY_LIST = 'http://u1:p1@host1:8000, host2:9000';
    process.env.PROXY_USERNAME = 'shared';
    process.env.PROXY_PASSWORD = 'sp';
    svc.load();

    expect(svc.isEnabled()).toBe(true);
    expect(svc.stats().total).toBe(2);

    // First proxy keeps its embedded creds; second inherits the shared creds.
    const a = svc.next();
    const b = svc.next();
    expect(a).toEqual({ server: 'http://host1:8000', username: 'u1', password: 'p1' });
    expect(b).toEqual({ server: 'http://host2:9000', username: 'shared', password: 'sp' });
  });

  it('rotates round-robin across the pool', () => {
    process.env.PROXY_LIST = 'http://a:1,http://b:1,http://c:1';
    svc.load();
    const seen = [svc.next()?.server, svc.next()?.server, svc.next()?.server, svc.next()?.server];
    expect(seen).toEqual(['http://a:1', 'http://b:1', 'http://c:1', 'http://a:1']);
  });

  it('cools down a proxy after repeated failures and recovers on success', () => {
    process.env.PROXY_LIST = 'http://only:1';
    svc.load();

    // Default PROXY_MAX_FAILURES = 3.
    svc.report('http://only:1', false);
    svc.report('http://only:1', false);
    expect(svc.stats().proxies[0].healthy).toBe(true); // 2 failures — not yet cooling down
    svc.report('http://only:1', false);
    expect(svc.stats().proxies[0].healthy).toBe(false); // 3rd failure — cooldown

    svc.report('http://only:1', true);
    expect(svc.stats().proxies[0].healthy).toBe(true); // success clears cooldown
  });

  it('is disabled when the list is empty or PROXY_ENABLED=false', () => {
    svc.load();
    expect(svc.isEnabled()).toBe(false);
    expect(svc.next()).toBeNull();

    process.env.PROXY_LIST = 'http://a:1';
    process.env.PROXY_ENABLED = 'false';
    svc.load();
    expect(svc.isEnabled()).toBe(false);
    expect(svc.next()).toBeNull();
  });

  it('ignores malformed entries', () => {
    process.env.PROXY_LIST = 'http://good:1, , :::not a url:::';
    svc.load();
    // The blank and the garbage entry are dropped; the good one remains.
    expect(svc.stats().total).toBe(1);
    expect(svc.next()?.server).toBe('http://good:1');
  });
});
