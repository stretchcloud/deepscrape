import * as cheerio from 'cheerio';

/**
 * Deterministic (LLM-free) contact extraction: emails, phone numbers, and social
 * profile links from a page. Generic and low-maintenance (regex + href parsing) —
 * useful for the lead-gen / contact-enrichment jobs that dominate demand, without
 * being a brittle per-platform social scraper.
 */

export interface ExtractedContacts {
  emails: string[];
  phones: string[];
  socials: Record<string, string>; // platform -> first profile URL found
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Conservative phone matcher: optional +country, then 7-14 digits with common separators.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/g;

const SOCIAL_HOSTS: Array<{ platform: string; re: RegExp }> = [
  { platform: 'twitter', re: /(?:twitter|x)\.com\/[A-Za-z0-9_]{2,}/i },
  { platform: 'linkedin', re: /linkedin\.com\/(?:in|company)\/[A-Za-z0-9-_%]+/i },
  { platform: 'facebook', re: /facebook\.com\/[A-Za-z0-9.\-_]+/i },
  { platform: 'instagram', re: /instagram\.com\/[A-Za-z0-9._]+/i },
  { platform: 'youtube', re: /youtube\.com\/(?:@|channel\/|c\/|user\/)[A-Za-z0-9._-]+/i },
  { platform: 'github', re: /github\.com\/[A-Za-z0-9-]+/i },
  { platform: 'tiktok', re: /tiktok\.com\/@[A-Za-z0-9._]+/i },
];

/** Reject values that look like image/asset filenames rather than real emails. */
function isRealEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico)$/.test(lower)) return false;
  if (lower.includes('example.com') || lower.startsWith('user@') || lower.startsWith('email@')) return false;
  return true;
}

/** Keep phone candidates that have a plausible number of digits (7-15). */
function isPlausiblePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function extractContacts(html: string, baseUrl?: string): ExtractedContacts {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const socials: Record<string, string> = {};

  if (!html) return { emails: [], phones: [], socials: {} };

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return { emails: [], phones: [], socials: {} };
  }

  // mailto:/tel: links are the most reliable signals.
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (/^mailto:/i.test(href)) {
      const addr = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (addr && isRealEmail(addr)) emails.add(addr.toLowerCase());
    } else if (/^tel:/i.test(href)) {
      const num = href.replace(/^tel:/i, '').trim();
      if (isPlausiblePhone(num)) phones.add(num);
    } else {
      for (const { platform, re } of SOCIAL_HOSTS) {
        if (!socials[platform]) {
          const m = href.match(re);
          if (m) {
            try {
              socials[platform] = baseUrl ? new URL(href, baseUrl).toString() : href;
            } catch {
              socials[platform] = href;
            }
          }
        }
      }
    }
  });

  // Free-text scan of the visible body for emails/phones the markup didn't link.
  const text = $('body').text() || '';
  for (const m of text.match(EMAIL_RE) ?? []) {
    if (isRealEmail(m)) emails.add(m.toLowerCase());
  }
  for (const m of text.match(PHONE_RE) ?? []) {
    const cleaned = m.trim();
    if (isPlausiblePhone(cleaned)) phones.add(cleaned);
  }

  return {
    emails: Array.from(emails).slice(0, 100),
    phones: Array.from(phones).slice(0, 50),
    socials,
  };
}
