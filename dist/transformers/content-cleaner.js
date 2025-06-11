"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentCleaner = void 0;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
class ContentCleaner {
    /**
     * Clean HTML content by removing ads, tracking scripts, etc.
     */
    clean(scraperResponse) {
        try {
            logger_1.logger.info(`Cleaning HTML content for URL: ${scraperResponse.url}`);
            if (!this.isValidHtmlContent(scraperResponse)) {
                logger_1.logger.warn('Content is not HTML or is empty, skipping cleaning');
                return scraperResponse;
            }
            const $ = cheerio.load(scraperResponse.content);
            this.logHeadingInfo($);
            const mainContent = this.findMainContent($);
            this.cleanDocument($);
            const cleanedHtml = this.extractCleanedHtml($, mainContent);
            return this.createCleanedResponse(scraperResponse, cleanedHtml);
        }
        catch (error) {
            return this.createErrorResponse(scraperResponse, error);
        }
    }
    /**
     * Remove common ads, tracking scripts, and unwanted elements
     */
    removeAdsAndTracking($) {
        // Remove scripts
        $('script').remove();
        // Remove style tags
        $('style').remove();
        // Remove common ad containers
        $('[id*="google_ad"], [id*="banner"], [id*="advertisement"], [class*="ad-"], [class*="ads-"], [class*="banner"]').remove();
        // Remove tracking pixels and iframes
        $('iframe[src*="doubleclick"], iframe[src*="googlead"], iframe[src*="facebook"], img[src*="pixel"]').remove();
        // Remove social sharing buttons
        $('[class*="share"], [class*="social"], [class*="twitter"], [class*="facebook"]').remove();
        // Remove comments sections (common patterns)
        $('#comments, .comments, .comment-section, .disqus, #disqus_thread').remove();
        // Remove newsletter signups, popups
        $('[class*="newsletter"], [class*="popup"], [class*="modal"], [id*="modal"], [id*="popup"]').remove();
        // Remove navigation elements (optional, may want to keep these)
        // $('nav, .nav, .navigation, .menu, header, footer').remove();
    }
    /**
     * Remove unnecessary attributes to clean up the HTML
     */
    removeAttributes($) {
        // List of attributes to remove
        const attributesToRemove = [
            'onclick', 'onmouseover', 'onmouseout', 'onload', 'onerror',
            'data-track', 'data-tracking', 'data-analytics', 'data-ga',
            'style', 'class', 'id', // Sometimes you may want to keep these for structure
            'tabindex', 'role', 'aria-*', // Accessibility attributes
        ];
        // For now, only remove event handlers and tracking attributes
        $('*').each((_i, el) => {
            for (const attr of Object.keys(el.attribs || {})) {
                if (attr.startsWith('on') || attr.includes('track') || attr.includes('analytics')) {
                    $(el).removeAttr(attr);
                }
            }
        });
    }
    /**
     * Remove hidden elements that are not visible to the user
     */
    removeHiddenElements($) {
        // Remove elements with inline styles hiding them
        $('[style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"]').remove();
        // Remove common hidden element classes
        $('.hidden, .hide, .invisible, .visually-hidden, .sr-only').remove();
    }
    /**
     * Check if content is valid HTML
     */
    isValidHtmlContent(scraperResponse) {
        return scraperResponse.contentType === 'html' && !!scraperResponse.content;
    }
    /**
     * Log heading information
     */
    logHeadingInfo($) {
        const headings = $('h1, h2, h3, h4, h5, h6').toArray();
        logger_1.logger.info(`Found ${headings.length} headings in the document`);
    }
    /**
     * Find main content using various strategies
     */
    findMainContent($) {
        let mainContent = this.findMainContentBySelectors($);
        if (!mainContent || mainContent.find('h1, h2, h3, h4, h5, h6').length === 0) {
            mainContent = this.findMainContentByTextDensity($);
        }
        if (!mainContent || mainContent.find('h1, h2, h3, h4, h5, h6').length === 0) {
            mainContent = this.constructContentFromHeadings($);
        }
        return mainContent;
    }
    /**
     * Find main content using CSS selectors
     */
    findMainContentBySelectors($) {
        const mainContentSelectors = [
            'main', 'article', '#main-content', '.main-content', '.article-content',
            '.post-content', '.entry-content', '[role="main"]', '#content', '.content',
            '.post', '.article', '.entry', '.doc', '.document', '.documentation',
            '#document-content', '.page-content', '.body-content', 'body', '.body'
        ];
        let mainContent = null;
        for (const selector of mainContentSelectors) {
            const element = $(selector);
            if (this.isValidContentElement(element)) {
                const foundHeadings = element.find('h1, h2, h3, h4, h5, h6').length;
                if (foundHeadings > 0) {
                    mainContent = element;
                    logger_1.logger.info(`Found main content using selector: ${selector} with ${foundHeadings} headings`);
                    break;
                }
                else if (!mainContent && element.text().trim().length > 500) {
                    mainContent = element;
                    logger_1.logger.info(`Found potential main content using selector: ${selector} (no headings)`);
                }
            }
        }
        return mainContent;
    }
    /**
     * Check if element is valid content element
     */
    isValidContentElement(element) {
        return element.length > 0 && element.text().trim().length > 300;
    }
    /**
     * Find main content by analyzing text density
     */
    findMainContentByTextDensity($) {
        logger_1.logger.info('No main content with headings found, using text density analysis');
        const textBlocks = this.analyzeTextBlocks($);
        if (textBlocks.length > 0) {
            const mainContent = $(textBlocks[0].element);
            const headingCount = mainContent.find('h1, h2, h3, h4, h5, h6').length;
            logger_1.logger.info(`Using largest text block with score ${textBlocks[0].textLength} and ${headingCount} headings`);
            return mainContent;
        }
        return null;
    }
    /**
     * Analyze text blocks and return scored elements
     */
    analyzeTextBlocks($) {
        const textBlocks = [];
        $('div, section, article').each((_, element) => {
            const text = $(element).text().trim();
            const headingCount = $(element).find('h1, h2, h3, h4, h5, h6').length;
            const score = text.length + (headingCount * 1000);
            if (text.length > 300 || headingCount > 0) {
                textBlocks.push({ element, textLength: score });
            }
        });
        return textBlocks.sort((a, b) => b.textLength - a.textLength);
    }
    /**
     * Construct content container from headings
     */
    constructContentFromHeadings($) {
        logger_1.logger.info('Creating artificial main content container with all heading sections');
        const contentContainer = $('<div class="constructed-content"></div>');
        const topHeadings = $('h1, h2').toArray();
        if (topHeadings.length > 0) {
            logger_1.logger.info(`Found ${topHeadings.length} top-level headings to extract content from`);
            this.extractHeadingSections($, topHeadings, contentContainer);
            return contentContainer;
        }
        return null;
    }
    /**
     * Extract content sections around headings
     */
    extractHeadingSections($, topHeadings, contentContainer) {
        for (let i = 0; i < topHeadings.length; i++) {
            const heading = $(topHeadings[i]);
            const nextHeading = i < topHeadings.length - 1 ? $(topHeadings[i + 1]) : null;
            contentContainer.append(heading.clone());
            this.extractContentBetweenHeadings(heading, nextHeading, contentContainer);
        }
    }
    /**
     * Extract content between two headings
     */
    extractContentBetweenHeadings(heading, nextHeading, contentContainer) {
        if (nextHeading) {
            this.extractContentUntilElement(heading[0], nextHeading[0], contentContainer);
        }
        else {
            this.extractContentUntilEnd(heading[0], contentContainer);
        }
    }
    /**
     * Extract content until specific element
     */
    extractContentUntilElement(startElement, endElement, container) {
        let current = startElement.nextSibling;
        while (current && current !== endElement) {
            if (current.nodeType === 1) {
                container.append(cheerio.load('')(current).clone());
            }
            current = current.nextSibling;
        }
    }
    /**
     * Extract content until end or next heading
     */
    extractContentUntilEnd(startElement, container) {
        let current = startElement.nextSibling;
        while (current) {
            if (current.nodeType === 1) {
                const nodeName = current.tagName?.toLowerCase();
                if (nodeName && nodeName.match(/^h[1-2]$/)) {
                    break;
                }
                container.append(cheerio.load('')(current).clone());
            }
            current = current.nextSibling;
        }
    }
    /**
     * Clean document by removing unwanted elements
     */
    cleanDocument($) {
        this.removeAdsAndTracking($);
        this.removeAttributes($);
        this.removeHiddenElements($);
    }
    /**
     * Extract cleaned HTML from document
     */
    extractCleanedHtml($, mainContent) {
        if (mainContent) {
            return this.extractMainContentHtml(mainContent);
        }
        else {
            logger_1.logger.info('No main content found, using entire cleaned document');
            return $.html();
        }
    }
    /**
     * Extract HTML from main content
     */
    extractMainContentHtml(mainContent) {
        const $mainContentWrapper = cheerio.load('')('<div class="main-content-wrapper"></div>');
        $mainContentWrapper.append(mainContent.clone());
        const mainContentHtml = $mainContentWrapper.html() || '';
        const $finalCheck = cheerio.load(mainContentHtml);
        const finalHeadings = $finalCheck('h1, h2, h3, h4, h5, h6').length;
        logger_1.logger.info(`Final cleaned HTML contains ${finalHeadings} headings`);
        return mainContentHtml;
    }
    /**
     * Create cleaned response object
     */
    createCleanedResponse(scraperResponse, cleanedHtml) {
        logger_1.logger.info('HTML content cleaning complete');
        return {
            ...scraperResponse,
            content: cleanedHtml
        };
    }
    /**
     * Create error response object
     */
    createErrorResponse(scraperResponse, error) {
        logger_1.logger.error(`Error cleaning HTML content: ${error instanceof Error ? error.message : String(error)}`);
        return {
            ...scraperResponse,
            error: `Content cleaning error: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}
exports.ContentCleaner = ContentCleaner;
