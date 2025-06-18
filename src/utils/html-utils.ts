import { load } from 'cheerio';

/**
 * Extract all links from HTML content
 * @param html The HTML content to extract links from
 * @param baseUrl The base URL to resolve relative links
 * @returns Array of unique extracted links
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  try {
    const $ = load(html);
    const links: string[] = [];
    
    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        try {
          const url = new URL(href, baseUrl);
          links.push(url.href);
        } catch (e) {
          // Invalid URL, ignore
        }
      }
    });
    
    return [...new Set(links)]; // Deduplicate links
  } catch (error) {
    console.error('Error extracting links from HTML', error);
    return [];
  }
} 