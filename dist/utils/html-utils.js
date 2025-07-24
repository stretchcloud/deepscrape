"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLinks = extractLinks;
const cheerio_1 = require("cheerio");
/**
 * Extract all links from HTML content
 * @param html The HTML content to extract links from
 * @param baseUrl The base URL to resolve relative links
 * @returns Array of unique extracted links
 */
function extractLinks(html, baseUrl) {
    try {
        const $ = (0, cheerio_1.load)(html);
        const links = [];
        $('a').each((_, element) => {
            const href = $(element).attr('href');
            if (href) {
                try {
                    const url = new URL(href, baseUrl);
                    links.push(url.href);
                }
                catch (error) {
                    // Invalid URL, ignore
                    console.debug(`Invalid URL found in href: ${href}, error: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        });
        return [...new Set(links)]; // Deduplicate links
    }
    catch (error) {
        console.error('Error extracting links from HTML', error);
        return [];
    }
}
