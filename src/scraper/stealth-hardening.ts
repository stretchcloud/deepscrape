import { randomBytes } from 'crypto';

/**
 * Anti-bot fingerprint HYGIENE — deliberately scoped.
 *
 * Headless automation leaks dozens of tiny signals (navigator.webdriver, a missing
 * window.chrome, empty plugin list, headless WebGL vendor, contradictory UA/platform)
 * that get a *legitimate* scrape falsely flagged as a bot. This module patches those
 * leaks and hands out internally-consistent fingerprint profiles so the signals agree.
 *
 * What this is NOT: it does not solve CAPTCHAs, does not defeat Cloudflare Turnstile /
 * DataDome, and is not a residential-proxy "unlocker." Hard targets need a purpose-built
 * anti-detect browser and are out of scope by design. robots.txt is still honored; this
 * only affects the browser's fingerprint, and it can be turned off (stealthMode:false).
 */

export interface FingerprintProfile {
  userAgent: string;
  platform: string;
  vendor: string;
  languages: string[];
  locale: string;
  timezoneId: string;
  viewport: { width: number; height: number };
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;
  webglRenderer: string;
}

/** A small set of realistic, internally-consistent desktop Chrome profiles. */
const PROFILES: FingerprintProfile[] = [
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Win32', vendor: 'Google Inc.', languages: ['en-US', 'en'], locale: 'en-US',
    timezoneId: 'America/New_York', viewport: { width: 1920, height: 1080 }, hardwareConcurrency: 8, deviceMemory: 8,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'MacIntel', vendor: 'Google Inc.', languages: ['en-US', 'en'], locale: 'en-US',
    timezoneId: 'America/Los_Angeles', viewport: { width: 1680, height: 1050 }, hardwareConcurrency: 8, deviceMemory: 8,
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)',
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Linux x86_64', vendor: 'Google Inc.', languages: ['en-US', 'en'], locale: 'en-US',
    timezoneId: 'America/Chicago', viewport: { width: 1920, height: 1080 }, hardwareConcurrency: 12, deviceMemory: 16,
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)',
  },
];

/** Pick a consistent profile; pass a seed to keep the same profile across a session/context. */
export function pickFingerprint(seed?: number): FingerprintProfile {
  const n = seed ?? randomBytes(1)[0];
  return PROFILES[n % PROFILES.length];
}

/**
 * Build the page init script that patches automation leaks to match `fp`.
 * Runs in page context (via context.addInitScript) before any page script.
 */
export function buildStealthInitScript(fp: FingerprintProfile): string {
  return `(() => {
    const patch = (obj, prop, val) => { try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch (e) {} };

    // navigator.webdriver — the single most-checked automation flag.
    patch(navigator, 'webdriver', undefined);

    // Keep platform/vendor/languages/hardware internally consistent with the UA.
    patch(navigator, 'languages', ${JSON.stringify(fp.languages)});
    patch(navigator, 'platform', ${JSON.stringify(fp.platform)});
    patch(navigator, 'vendor', ${JSON.stringify(fp.vendor)});
    patch(navigator, 'hardwareConcurrency', ${fp.hardwareConcurrency});
    patch(navigator, 'deviceMemory', ${fp.deviceMemory});

    // Headless has an empty plugin/mimeType list; give it a non-empty one.
    patch(navigator, 'plugins', [1, 2, 3, 4, 5]);
    patch(navigator, 'mimeTypes', [1, 2]);

    // window.chrome.runtime is present in real Chrome, absent in headless.
    try { window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {}; } catch (e) {}

    // permissions.query for notifications returns an inconsistent state in headless.
    try {
      const orig = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = (p) =>
        (p && p.name === 'notifications')
          ? Promise.resolve({ state: (typeof Notification !== 'undefined' ? Notification.permission : 'default') })
          : orig(p);
    } catch (e) {}

    // WebGL UNMASKED_VENDOR/RENDERER expose the headless GPU (SwiftShader); spoof to a real GPU.
    try {
      const spoof = function (getParameter) {
        return function (p) {
          if (p === 37445) return ${JSON.stringify(fp.webglVendor)};
          if (p === 37446) return ${JSON.stringify(fp.webglRenderer)};
          return getParameter.call(this, p);
        };
      };
      if (window.WebGLRenderingContext) {
        WebGLRenderingContext.prototype.getParameter = spoof(WebGLRenderingContext.prototype.getParameter);
      }
      if (window.WebGL2RenderingContext) {
        WebGL2RenderingContext.prototype.getParameter = spoof(WebGL2RenderingContext.prototype.getParameter);
      }
    } catch (e) {}
  })();`;
}
