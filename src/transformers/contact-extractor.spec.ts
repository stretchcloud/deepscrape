import { extractContacts } from './contact-extractor';

describe('contact-extractor', () => {
  const html = `
    <html><body>
      <p>Reach us at <a href="mailto:sales@acme.io?subject=hi">sales@acme.io</a> or hello@acme.io.</p>
      <p>Call <a href="tel:+1-415-555-0132">+1 (415) 555-0132</a>.</p>
      <footer>
        <a href="https://twitter.com/acmehq">Twitter</a>
        <a href="https://www.linkedin.com/company/acme-inc">LinkedIn</a>
        <a href="https://github.com/acme">GitHub</a>
        <img src="https://cdn.acme.io/logo@2x.png">
      </footer>
    </body></html>`;

  it('extracts emails from both mailto links and body text, deduped and lowercased', () => {
    const c = extractContacts(html, 'https://acme.io');
    expect(c.emails).toContain('sales@acme.io');
    expect(c.emails).toContain('hello@acme.io');
    expect(new Set(c.emails).size).toBe(c.emails.length);
  });

  it('extracts a plausible phone number', () => {
    const c = extractContacts(html);
    expect(c.phones.some(p => p.replace(/\D/g, '').includes('4155550132'))).toBe(true);
  });

  it('extracts social profile links by platform, resolved to absolute URLs', () => {
    const c = extractContacts(html, 'https://acme.io');
    expect(c.socials.twitter).toContain('twitter.com/acmehq');
    expect(c.socials.linkedin).toContain('linkedin.com/company/acme-inc');
    expect(c.socials.github).toContain('github.com/acme');
  });

  it('rejects asset filenames that look like emails and handles empty input', () => {
    expect(extractContacts('<a href="mailto:logo@2x.png">x</a>').emails).toHaveLength(0);
    expect(extractContacts('')).toEqual({ emails: [], phones: [], socials: {} });
  });
});
