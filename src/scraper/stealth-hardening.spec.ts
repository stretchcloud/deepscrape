import { pickFingerprint, buildStealthInitScript } from './stealth-hardening';

describe('stealth-hardening', () => {
  describe('pickFingerprint', () => {
    it('is deterministic for a given seed and consistent within a profile', () => {
      const a = pickFingerprint(0);
      const b = pickFingerprint(0);
      expect(a).toEqual(b);
      // UA and platform must agree (no Windows-UA-with-Mac-platform contradictions).
      for (const seed of [0, 1, 2, 3, 4, 5]) {
        const fp = pickFingerprint(seed);
        if (fp.platform === 'Win32') expect(fp.userAgent).toContain('Windows');
        if (fp.platform === 'MacIntel') expect(fp.userAgent).toContain('Macintosh');
        if (fp.platform === 'Linux x86_64') expect(fp.userAgent).toContain('Linux');
        expect(fp.languages.length).toBeGreaterThan(0);
        expect(fp.timezoneId).toMatch(/\//);
      }
    });

    it('covers more than one profile across seeds', () => {
      const uas = new Set([0, 1, 2].map(s => pickFingerprint(s).userAgent));
      expect(uas.size).toBeGreaterThan(1);
    });
  });

  describe('buildStealthInitScript', () => {
    it('patches the key automation leaks, consistent with the fingerprint', () => {
      const fp = pickFingerprint(0);
      const script = buildStealthInitScript(fp);
      expect(script).toContain('\'webdriver\'');
      expect(script).toContain('\'plugins\'');
      expect(script).toContain('chrome.runtime');
      expect(script).toContain('37445'); // UNMASKED_VENDOR_WEBGL
      expect(script).toContain('37446'); // UNMASKED_RENDERER_WEBGL
      expect(script).toContain(fp.webglRenderer);
      expect(script).toContain(fp.platform);
      // It must be a self-invoking script safe to inject.
      expect(script.trim().startsWith('(()')).toBe(true);
    });
  });
});
