import { URLValidationUtils } from './url-validation.utils';

describe('URLValidationUtils.registrableDomain', () => {
  const cases: [string, string][] = [
    ['www.sonarsource.com', 'sonarsource.com'],
    ['docs.sonarsource.com', 'sonarsource.com'],
    ['sonarsource.com', 'sonarsource.com'],
    ['a.b.c.sonarsource.com', 'sonarsource.com'],
    ['fuel-finder.uk', 'fuel-finder.uk'],
    ['www.example.co.uk', 'example.co.uk'],
    ['docs.example.co.uk', 'example.co.uk'],
    ['shop.example.com.au', 'example.com.au'],
    ['localhost', 'localhost'],
    ['192.168.0.1', '192.168.0.1'],
    ['WWW.SonarSource.COM', 'sonarsource.com'],
  ];
  it.each(cases)('%s -> %s', (host, expected) => {
    expect(URLValidationUtils.registrableDomain(host)).toBe(expected);
  });
});

describe('URLValidationUtils.matchesDomain (the includeSubdomains fix)', () => {
  const seed = 'https://www.sonarsource.com';

  it('keeps sibling subdomains when includeSubdomains is true (regression)', () => {
    // This is the exact bug: a www. seed used to DROP docs./blog./community.
    expect(URLValidationUtils.matchesDomain('https://docs.sonarsource.com/x', seed, true)).toBe(true);
    expect(URLValidationUtils.matchesDomain('https://blog.sonarsource.com/y', seed, true)).toBe(true);
    expect(URLValidationUtils.matchesDomain('https://www.sonarsource.com/z', seed, true)).toBe(true);
    expect(URLValidationUtils.matchesDomain('https://sonarsource.com/', seed, true)).toBe(true);
  });

  it('still excludes unrelated / look-alike domains', () => {
    expect(URLValidationUtils.matchesDomain('https://evilsonarsource.com', seed, true)).toBe(false);
    expect(URLValidationUtils.matchesDomain('https://sonarsource.com.attacker.net', seed, true)).toBe(false);
    expect(URLValidationUtils.matchesDomain('https://example.com', seed, true)).toBe(false);
  });

  it('respects a co.uk registrable boundary (no cross-site bleed)', () => {
    const ukSeed = 'https://www.example.co.uk';
    expect(URLValidationUtils.matchesDomain('https://docs.example.co.uk/a', ukSeed, true)).toBe(true);
    expect(URLValidationUtils.matchesDomain('https://other.co.uk/a', ukSeed, true)).toBe(false);
  });

  it('exact-host-only when includeSubdomains is false', () => {
    expect(URLValidationUtils.matchesDomain('https://www.sonarsource.com/x', seed, false)).toBe(true);
    expect(URLValidationUtils.matchesDomain('https://docs.sonarsource.com/x', seed, false)).toBe(false);
  });
});
