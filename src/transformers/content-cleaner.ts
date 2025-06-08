import * as cheerio from 'cheerio';
import { ScraperResponse } from '../types';
import { logger } from '../utils/logger';

// Define type for the text blocks to fix linter errors
type TextBlock = {
  element: any; // Using any to avoid cheerio type issues
  textLength: number;
};

export class ContentCleaner {
  /**
   * Clean HTML content by removing ads, tracking scripts, etc.
   */
  clean(scraperResponse: ScraperResponse): ScraperResponse {
    try {
      logger.info(`Cleaning HTML content for URL: ${scraperResponse.url}`);
      
      if (!this.isValidHtmlContent(scraperResponse)) {
        logger.warn('Content is not HTML or is empty, skipping cleaning');
        return scraperResponse;
      }

      const $ = cheerio.load(scraperResponse.content);
      this.logHeadingInfo($);
      
      const mainContent = this.findMainContent($);
      this.cleanDocument($);
      const cleanedHtml = this.extractCleanedHtml($, mainContent);
      
      return this.createCleanedResponse(scraperResponse, cleanedHtml);
    } catch (error) {
      return this.createErrorResponse(scraperResponse, error);
    }
  }
  
  /**
   * Remove common ads, tracking scripts, and unwanted elements
   */
  private removeAdsAndTracking($: cheerio.CheerioAPI): void {
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
  private removeAttributes($: cheerio.CheerioAPI): void {
    // List of attributes to remove
    const attributesToRemove = [
      'onclick', 'onmouseover', 'onmouseout', 'onload', 'onerror',
      'data-track', 'data-tracking', 'data-analytics', 'data-ga',
      'style', 'class', 'id', // Sometimes you may want to keep these for structure
      'tabindex', 'role', 'aria-*', // Accessibility attributes
    ];
    
    // For now, only remove event handlers and tracking attributes
    $('*').each((_i, el) => {
      for (const attr of Object.keys((el as any).attribs || {})) {
        if (attr.startsWith('on') || attr.includes('track') || attr.includes('analytics')) {
          $(el).removeAttr(attr);
        }
      }
    });
  }
  
  /**
   * Remove hidden elements that are not visible to the user
   */
  private removeHiddenElements($: cheerio.CheerioAPI): void {
    // Remove elements with inline styles hiding them
    $('[style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"]').remove();
    
    // Remove common hidden element classes
    $('.hidden, .hide, .invisible, .visually-hidden, .sr-only').remove();
  }

  /**
   * Check if content is valid HTML
   */
  private isValidHtmlContent(scraperResponse: ScraperResponse): boolean {
    return scraperResponse.contentType === 'html' && !!scraperResponse.content;
  }

  /**
   * Log heading information
   */
  private logHeadingInfo($: cheerio.CheerioAPI): void {
    const headings = $('h1, h2, h3, h4, h5, h6').toArray();
    logger.info(`Found ${headings.length} headings in the document`);
  }

  /**
   * Find main content using various strategies
   */
  private findMainContent($: cheerio.CheerioAPI): cheerio.Cheerio<any> | null {
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
  private findMainContentBySelectors($: cheerio.CheerioAPI): cheerio.Cheerio<any> | null {
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
          logger.info(`Found main content using selector: ${selector} with ${foundHeadings} headings`);
          break;
        } else if (!mainContent && element.text().trim().length > 500) {
          mainContent = element;
          logger.info(`Found potential main content using selector: ${selector} (no headings)`);
        }
      }
    }
    
    return mainContent;
  }

  /**
   * Check if element is valid content element
   */
  private isValidContentElement(element: cheerio.Cheerio<any>): boolean {
    return element.length > 0 && element.text().trim().length > 300;
  }

  /**
   * Find main content by analyzing text density
   */
  private findMainContentByTextDensity($: cheerio.CheerioAPI): cheerio.Cheerio<any> | null {
    logger.info('No main content with headings found, using text density analysis');
    
    const textBlocks = this.analyzeTextBlocks($);
    
    if (textBlocks.length > 0) {
      const mainContent = $(textBlocks[0].element);
      const headingCount = mainContent.find('h1, h2, h3, h4, h5, h6').length;
      logger.info(`Using largest text block with score ${textBlocks[0].textLength} and ${headingCount} headings`);
      return mainContent;
    }
    
    return null;
  }

  /**
   * Analyze text blocks and return scored elements
   */
  private analyzeTextBlocks($: cheerio.CheerioAPI): TextBlock[] {
    const textBlocks: TextBlock[] = [];
    
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
  private constructContentFromHeadings($: cheerio.CheerioAPI): cheerio.Cheerio<any> | null {
    logger.info('Creating artificial main content container with all heading sections');
    
    const contentContainer = $('<div class="constructed-content"></div>');
    const topHeadings = $('h1, h2').toArray();
    
    if (topHeadings.length > 0) {
      logger.info(`Found ${topHeadings.length} top-level headings to extract content from`);
      this.extractHeadingSections($, topHeadings, contentContainer);
      return contentContainer;
    }
    
    return null;
  }

  /**
   * Extract content sections around headings
   */
  private extractHeadingSections($: cheerio.CheerioAPI, topHeadings: any[], contentContainer: cheerio.Cheerio<any>): void {
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
  private extractContentBetweenHeadings(
    heading: cheerio.Cheerio<any>, 
    nextHeading: cheerio.Cheerio<any> | null, 
    contentContainer: cheerio.Cheerio<any>
  ): void {
    if (nextHeading) {
      this.extractContentUntilElement(heading[0], nextHeading[0], contentContainer);
    } else {
      this.extractContentUntilEnd(heading[0], contentContainer);
    }
  }

  /**
   * Extract content until specific element
   */
  private extractContentUntilElement(startElement: any, endElement: any, container: cheerio.Cheerio<any>): void {
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
  private extractContentUntilEnd(startElement: any, container: cheerio.Cheerio<any>): void {
    let current = startElement.nextSibling;
    while (current) {
      if (current.nodeType === 1) {
        const nodeName = (current as any).tagName?.toLowerCase();
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
  private cleanDocument($: cheerio.CheerioAPI): void {
    this.removeAdsAndTracking($);
    this.removeAttributes($);
    this.removeHiddenElements($);
  }

  /**
   * Extract cleaned HTML from document
   */
  private extractCleanedHtml($: cheerio.CheerioAPI, mainContent: cheerio.Cheerio<any> | null): string {
    if (mainContent) {
      return this.extractMainContentHtml(mainContent);
    } else {
      logger.info('No main content found, using entire cleaned document');
      return $.html();
    }
  }

  /**
   * Extract HTML from main content
   */
  private extractMainContentHtml(mainContent: cheerio.Cheerio<any>): string {
    const $mainContentWrapper = cheerio.load('')('<div class="main-content-wrapper"></div>');
    $mainContentWrapper.append(mainContent.clone());
    const mainContentHtml = $mainContentWrapper.html() || '';
    
    const $finalCheck = cheerio.load(mainContentHtml);
    const finalHeadings = $finalCheck('h1, h2, h3, h4, h5, h6').length;
    logger.info(`Final cleaned HTML contains ${finalHeadings} headings`);
    
    return mainContentHtml;
  }

  /**
   * Create cleaned response object
   */
  private createCleanedResponse(scraperResponse: ScraperResponse, cleanedHtml: string): ScraperResponse {
    logger.info('HTML content cleaning complete');
    return {
      ...scraperResponse,
      content: cleanedHtml
    };
  }

  /**
   * Create error response object
   */
  private createErrorResponse(scraperResponse: ScraperResponse, error: any): ScraperResponse {
    logger.error(`Error cleaning HTML content: ${error instanceof Error ? error.message : String(error)}`);
    
    return {
      ...scraperResponse,
      error: `Content cleaning error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
} 