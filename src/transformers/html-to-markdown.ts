import TurndownService from 'turndown';
import { ScraperResponse } from '../types';
import { logger } from '../utils/logger';
import * as cheerio from 'cheerio';
import { Element, Node } from 'domhandler';

// List of selectors for elements that should be removed as they're not part of the main content
const EXCLUDE_NON_MAIN_TAGS = [
  'header',
  'footer',
  'nav',
  'aside',
  '.header',
  '.top',
  '.navbar',
  '#header',
  '.footer',
  '.bottom',
  '#footer',
  '.sidebar',
  '.side',
  '.aside',
  '#sidebar',
  '.modal',
  '.popup',
  '#modal',
  '.overlay',
  '.ad',
  '.ads',
  '.advert',
  '#ad',
  '.lang-selector',
  '.language',
  '#language-selector',
  '.social',
  '.social-media',
  '.social-links',
  '#social',
  '.menu',
  '.navigation',
  '#nav',
  '.breadcrumbs',
  '#breadcrumbs',
  '.share',
  '#share',
  '.widget',
  '#widget',
  '.cookie',
  '#cookie',
  '#consent',
  '.consent',
  '.gdpr',
  '.banner',
  '#banner',
  '.alert',
  '#alert',
  '.notification',
  '#notification',
  '.newsletter',
  '#newsletter',
  '.signup',
  '#signup',
  '.login',
  '#login',
  '.search',
  '#search',
  '.promo',
  '#promo',
];

// List of selectors that should be kept even if they match the exclusion rules
const FORCE_INCLUDE_MAIN_TAGS = ['#main', '.main-content', 'article', 'main', '[role="main"]'];

// List of main content selectors to look for when extracting content
const MAIN_CONTENT_SELECTORS = [
  'article',
  'main',
  '.main-content',
  '.article',
  '.post',
  '.content',
  '#content',
  '[role="main"]',
  '.post-content',
  '.entry-content',
  '.page-content',
  '.article-content',
  '.main',
  '#main',
  '.body',
  '#body',
];

// Content quality threshold for extraction
const CONTENT_THRESHOLD = 20;

export class HtmlToMarkdownTransformer {
  private turndownService: TurndownService;

  constructor() {
    // Initialize Turndown with options
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full'
    });

    // Configure turndown rules
    this.configureTurndownRules();
  }

  /**
   * Configure custom rules for Turndown
   */
  private configureTurndownRules(): void {
    // Preserve certain HTML elements (e.g., tables)
    this.turndownService.keep(['table', 'tr', 'td', 'th', 'thead', 'tbody']);

    // Add rule for removing script and style tags
    this.turndownService.addRule('removeScriptAndStyle', {
      filter: ['script', 'style', 'noscript'],
      replacement: () => ''
    });

    // Improve code block handling
    this.turndownService.addRule('codeBlocks', {
      filter: (node) => {
        return (
          node.nodeName === 'PRE' &&
          node.firstChild &&
          node.firstChild.nodeName === 'CODE'
        ) ? true : false;
      },
      replacement: (content, node) => {
        const code = node.textContent || '';
        const language = node.firstChild && 
          (node.firstChild as HTMLElement).className
            ? (node.firstChild as HTMLElement).className.replace('language-', '')
            : '';
        
        return '\n\n```' + language + '\n' + code.trim() + '\n```\n\n';
      }
    });

    // Improve links formatting
    this.turndownService.addRule('links', {
      filter: 'a',
      replacement: (content, node) => {
        const href = (node as HTMLElement).getAttribute('href');
        const title = (node as HTMLElement).getAttribute('title');
        
        if (!href) return content;
        
        // Skip empty links or anchors with no content
        if (!content.trim()) return '';
        
        // Format links consistently and ensure proper URL formatting
        let finalHref = href;
        if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('#')) {
          finalHref = href.startsWith('/') ? `${this.baseUrl}${href}` : `${this.baseUrl}/${href}`;
        }
        
        // Prevent line breaks inside links by replacing them
        let linkContent = content.trim().replace(/\n/g, ' ');
        
        return `[${linkContent}](${finalHref}${title ? ` "${title}"` : ''})`;
      }
    });

    // Enhance heading formatting
    this.turndownService.addRule('headings', {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      replacement: (content, node) => {
        const hLevel = parseInt(node.nodeName.charAt(1));
        const hashes = '#'.repeat(hLevel);
        return `\n\n${hashes} ${content.trim()}\n\n`;
      }
    });

    // Improve list formatting
    this.turndownService.addRule('lists', {
      filter: ['ul', 'ol'],
      replacement: (content) => {
        return `\n\n${content.trim()}\n\n`;
      }
    });

    // Better handling for list items
    this.turndownService.addRule('listItems', {
      filter: 'li',
      replacement: (content, node, options) => {
        const parent = node.parentNode;
        const isOrdered = parent && parent.nodeName === 'OL';
        
        // Handle index properly for ordered lists
        const index = parent ? Array.from(parent.childNodes || [])
          .filter(n => n.nodeType === 1 && (n as HTMLElement).tagName === 'LI')
          .indexOf(node as HTMLElement) + 1 : 1;
        
        const prefix = isOrdered ? `${index}. ` : `${options.bulletListMarker} `;
        
        // Ensure proper indentation for nested lists
        let nestedContent = content.trim();
        nestedContent = nestedContent.replace(/\n/g, '\n  ');
        
        return `\n${prefix}${nestedContent}`;
      }
    });

    // Improve paragraph handling
    this.turndownService.addRule('paragraphs', {
      filter: 'p',
      replacement: (content) => {
        return `\n\n${content.trim()}\n\n`;
      }
    });

    // Improve image handling
    this.turndownService.addRule('images', {
      filter: 'img',
      replacement: (content, node) => {
        const alt = (node as HTMLElement).getAttribute('alt') || '';
        const src = (node as HTMLElement).getAttribute('src') || '';
        const title = (node as HTMLElement).getAttribute('title') || '';
        
        if (!src) return '';
        
        // Handle base64 images - either remove or limit them
        if (src.startsWith('data:image')) {
          return '![' + alt + '](Base64-Image-Removed)';
        }
        
        // Format images consistently and ensure proper URL formatting
        let finalSrc = src;
        if (!src.startsWith('http') && !src.startsWith('data:')) {
          finalSrc = src.startsWith('/') ? `${this.baseUrl}${src}` : `${this.baseUrl}/${src}`;
        }
        
        return `![${alt}](${finalSrc}${title ? ` "${title}"` : ''})`;
      }
    });

    // Remove empty or whitespace-only paragraphs
    this.turndownService.addRule('removeEmptyParagraphs', {
      filter: (node) => {
        return node.nodeName === 'P' && 
               (!node.textContent || node.textContent.trim() === '') && 
               !node.childNodes.length;
      },
      replacement: () => ''
    });

    // Remove consecutive newlines
    this.turndownService.addRule('removeConsecutiveNewlines', {
      filter: (node) => {
        return node.nodeType === 3 && /\n\s*\n/.test(node.nodeValue || '');
      },
      replacement: (content) => {
        return content.replace(/\n\s*\n/g, '\n\n');
      }
    });
  }

  /**
   * Clean HTML content before converting to markdown
   */
  private cleanHtml(html: string, onlyMainContent: boolean = true): string {
    const $ = cheerio.load(html);

    // Log the number of headings before cleaning
    const initialHeadings = $('h1, h2, h3, h4, h5, h6').length;
    logger.debug(`Initial HTML contains ${initialHeadings} headings`);

    // Remove definitely unwanted elements first
    $('script, style, noscript, meta, link[rel="stylesheet"]').remove();
    
    if (!onlyMainContent) {
      // If not extracting only main content, just do basic cleaning
      this.removeUnwantedElements($);
      return $.html();
    }
    
    // First, set a special attribute on headings to make sure we can find them again
    $('h1, h2, h3, h4, h5, h6').attr('data-preserve-heading', 'true');
    
    // Try advanced content extraction
    const extractedContent = this.extractMainContent(html);
    if (extractedContent && extractedContent.trim().length > 0) {
      // Load the extracted content into a new Cheerio instance for final cleaning
      const $extracted = cheerio.load(extractedContent);
      
      // Check if we have headings in the extracted content
      const extractedHeadings = $extracted('[data-preserve-heading="true"]').length;
      logger.debug(`Extracted content contains ${extractedHeadings} preserved headings`);
      
      if (extractedHeadings === 0) {
        // If no headings, this might not be the right content - try an alternative approach
        logger.debug('No headings in extracted content, attempting heading-based extraction');
        
        // Try a heading-based approach - get all h1, h2 elements and their content
        const headingContent = this.extractHeadingsAndContent($);
        if (headingContent && headingContent.trim().length > 0) {
          logger.debug('Successfully extracted content using heading-based approach');
          return headingContent;
        }
      }
      
      // Apply final cleaning to the extracted content
      this.removeUnwantedElements($extracted);
      
      // Check heading count after cleaning
      const finalHeadings = $extracted('[data-preserve-heading="true"]').length;
      logger.debug(`After cleaning, extracted content has ${finalHeadings} headings`);
      
      return $extracted.html() || '';
    }
    
    // If extraction failed, fall back to heading-based approach
    logger.debug('Initial extraction failed, trying heading-based approach');
    const headingContent = this.extractHeadingsAndContent($);
    if (headingContent && headingContent.trim().length > 0) {
      logger.debug('Successfully extracted content using heading-based approach');
      return headingContent;
    }
    
    // If all else fails, use the previous approach
    this.removeUnwantedElements($);
    
    // If still no main content found, remove non-main elements
    EXCLUDE_NON_MAIN_TAGS.forEach(selector => {
      $(selector).each((_, el) => {
        // Don't remove headings or elements containing headings
        if ($(el).is('[data-preserve-heading="true"]') || $(el).find('[data-preserve-heading="true"]').length > 0) {
          return;
        }
        
        // Check if the element contains any forced include elements before removing
        let shouldKeep = false;
        FORCE_INCLUDE_MAIN_TAGS.forEach(includeSelector => {
          if ($(el).find(includeSelector).length > 0) {
            shouldKeep = true;
          }
        });
        
        if (!shouldKeep) {
          $(el).remove();
        }
      });
    });
    
    // Log the final heading count
    const finalHeadings = $('[data-preserve-heading="true"]').length;
    logger.debug(`Final HTML contains ${finalHeadings} headings`);
    
    return $.html();
  }

  /**
   * Extract headings and their content
   */
  private extractHeadingsAndContent($: cheerio.CheerioAPI): string {
    const $container = this.createContentContainer();
    const headings = this.getTopLevelHeadings($);
    
    if (!this.hasValidHeadings(headings)) {
      return '';
    }
    
    this.processHeadings($, headings, $container);
    return this.getContainerHtml($container);
  }

  /**
   * Remove common unwanted elements from HTML
   */
  private removeUnwantedElements($: cheerio.CheerioAPI): void {
    // Remove cookie consent, privacy popups and banners
    $('.cookie-banner, .cookie-notice, .cookie-dialog, .cookie-consent, .gdpr, .consent, .privacy-banner, .privacy-notice, [aria-label*="cookie"], [class*="cookie"]').remove();
    $('[id*="cookie"], [id*="consent"], [id*="privacy-banner"], [id*="cookie-banner"]').remove();

    // Remove navigation elements, headers, footers, sidebars
    $('nav, .nav, .navbar, .navigation, .menu-container, .site-navigation').remove();
    $('header:not(:has(h1,h2,h3,h4,h5,h6)), footer, aside, .sidebar, .left-sidebar, .right-sidebar').remove();
    $('.menu:not(article .menu), .main-menu, .top-menu, .footer-menu, .utility-nav').remove();

    // Remove ads and banners
    $('.ad, .ads, .advertisement, .banner, .sponsored, [id*="ad-"], [class*="ad-"]').remove();
    $('[id*="banner"], [class*="banner"], [id*="ads"], [class*="advertisement"]').remove();

    // Remove comment sections
    $('.comments, .comment-section, .disqus, #disqus_thread, [id*="comment"], [class*="comment"]').remove();

    // Remove social sharing widgets
    $('.social, .social-share, .share-buttons, .social-links, .social-icons, [class*="share"], [class*="social"]').remove();

    // Remove forms, sign-up, subscription elements
    $('form, .form, .login, .signup, .register, .subscribe, .newsletter, [class*="form-"], [id*="form-"]').remove();
    $('[class*="login"], [class*="signup"], [class*="subscribe"], [class*="newsletter"]').remove();

    // Remove related content, suggestions, recommendations
    $('.related, .suggested, .recommendations, .read-more, .more-articles, [class*="related-"], [class*="suggested-"]').remove();

    // Remove popups, modals, overlays
    $('.popup, .modal, .overlay, .lightbox, [class*="popup"], [class*="modal"], [class*="overlay"]').remove();

    // Remove hidden elements
    $('[style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"], [hidden], .hidden, .invisible').remove();

    // Remove tracking elements
    $('[data-track], [data-tracking], [data-analytics], [class*="analytics"], [id*="analytics"]').remove();
    $('iframe[src*="analytics"], iframe[src*="tracking"], iframe[src*="pixel"]').remove();
    $('img[src*="pixel"], img[src*="tracker"], img[src*="tracking"]').remove();

    // Remove dynamic loading indicators
    $('.loading, .spinner, .loader, [class*="loading"], [class*="spinner"], [class*="loader"]').remove();

    // Clean attributes that aren't necessary for markdown
    $('*').each((_, el) => {
      // Using type assertion to access attribs
      const element = el as any;
      
      // Skip if element doesn't have attributes
      if (!element.attribs) return;
      
      const attrs = element.attribs;
      Object.keys(attrs).forEach(attr => {
        // Keep only essential attributes
        if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(attr)) {
          $(element).removeAttr(attr);
        }
      });
    });

    // Handle empty elements
    $('p, div, span').each((_, el) => {
      if ($(el).text().trim() === '' && !$(el).find('img').length) {
        $(el).remove();
      }
    });

    // Fix spacing and formatting for headings
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        $(el).html(text);
      }
    });

    // Improve table formatting
    $('table').each((_, table) => {
      // Ensure tables have headers if they don't
      if ($(table).find('thead').length === 0 && $(table).find('th').length === 0) {
        const firstRow = $(table).find('tr').first();
        firstRow.find('td').each((_, cell) => {
          const content = $(cell).html() || '';
          $(cell).replaceWith(`<th>${content}</th>`);
        });
        
        const thead = $('<thead></thead>');
        thead.append(firstRow);
        $(table).prepend(thead);
      }
    });
  }

  /**
   * Create content container for extracted headings
   */
  private createContentContainer(): cheerio.Cheerio<any> {
    const $result = cheerio.load('<div class="heading-based-content"></div>');
    return $result('.heading-based-content');
  }

  /**
   * Get top-level headings from document
   */
  private getTopLevelHeadings($: cheerio.CheerioAPI): any[] {
    return $('h1, h2').toArray();
  }

  /**
   * Check if headings are valid for extraction
   */
  private hasValidHeadings(headings: any[]): boolean {
    if (headings.length === 0) {
      logger.debug('No h1/h2 headings found for extraction');
      return false;
    }
    
    logger.debug(`Found ${headings.length} h1/h2 headings for extraction`);
    return true;
  }

  /**
   * Process all headings and extract their content
   */
  private processHeadings($: cheerio.CheerioAPI, headings: any[], $container: cheerio.Cheerio<any>): void {
    for (let i = 0; i < headings.length; i++) {
      const heading = $(headings[i]);
      const nextHeading = this.getNextHeading(headings, i);
      
      this.extractHeadingSection($, heading, nextHeading, $container);
    }
  }

  /**
   * Get next heading in the sequence
   */
  private getNextHeading(headings: any[], currentIndex: number): cheerio.Cheerio<any> | null {
    return currentIndex < headings.length - 1 ? cheerio.load('')(headings[currentIndex + 1]) : null;
  }

  /**
   * Extract content for a single heading section
   */
  private extractHeadingSection(
    $: cheerio.CheerioAPI, 
    heading: cheerio.Cheerio<any>, 
    nextHeading: cheerio.Cheerio<any> | null, 
    $container: cheerio.Cheerio<any>
  ): void {
    $container.append(heading.clone());
    
    if (nextHeading) {
      this.extractContentUntilNextHeading(heading, nextHeading, $container);
    } else {
      this.extractContentUntilEnd($, heading, $container);
    }
  }

  /**
   * Extract content until next heading
   */
  private extractContentUntilNextHeading(
    heading: cheerio.Cheerio<any>, 
    nextHeading: cheerio.Cheerio<any>, 
    $container: cheerio.Cheerio<any>
  ): void {
    let current = heading[0].nextSibling;
    while (current && current !== nextHeading[0]) {
      if (this.isElementNode(current)) {
        $container.append(cheerio.load('')(current).clone());
      }
      current = current.nextSibling;
    }
  }

  /**
   * Extract content until end of document or next heading
   */
  private extractContentUntilEnd(
    $: cheerio.CheerioAPI, 
    heading: cheerio.Cheerio<any>, 
    $container: cheerio.Cheerio<any>
  ): void {
    let current = heading[0].nextSibling;
    let contentAdded = 0;
    
    while (current && contentAdded < 10000) {
      if (this.isElementNode(current)) {
        if (this.shouldStopAtHeading(current)) {
          break;
        }
        
        $container.append($(current).clone());
        contentAdded += $(current).text().length;
      }
      current = current.nextSibling;
    }
  }

  /**
   * Check if node is an element node
   */
  private isElementNode(node: any): boolean {
    return node.nodeType === 1;
  }

  /**
   * Check if we should stop at this heading
   */
  private shouldStopAtHeading(node: any): boolean {
    const tagName = (node as any).tagName?.toLowerCase();
    return tagName && tagName.match(/^h[1-2]$/);
  }

  /**
   * Get HTML from container
   */
  private getContainerHtml($container: cheerio.Cheerio<any>): string {
    const $result = $container.parent();
    return $result.html() || '';
  }
  
  /**
   * Extract main content using multiple strategies
   */
  private extractMainContent(html: string): string {
    const $ = cheerio.load(html);
    
    // First attempt: Try known content selectors
    const mainContentSelector = this.findBestContentSelector($);
    if (mainContentSelector) {
      const mainContent = $(mainContentSelector);
      if (mainContent.length && this.isContentRich(mainContent)) {
        return $('<div>').append(mainContent.clone()).html() || '';
      }
    }
    
    // Second attempt: Use text density analysis
    return this.extractByTextDensity($);
  }

  /**
   * Find the best content selector based on content metrics
   */
  private findBestContentSelector($: cheerio.CheerioAPI): string | null {
    // Try each selector and score based on content metrics
    let bestScore = 0;
    let bestSelector = null;
    
    for (const selector of MAIN_CONTENT_SELECTORS) {
      const element = $(selector);
      if (element.length) {
        const score = this.calculateContentScore(element);
        if (score > bestScore) {
          bestScore = score;
          bestSelector = selector;
        }
      }
    }
    
    return bestSelector;
  }

  /**
   * Calculate a content quality score based on multiple factors
   */
  private calculateContentScore(element: any): number {
    // Text length (longer = better)
    const text = element.text().trim();
    const textLength = text.length;
    
    // Text/HTML ratio (higher = better)
    const html = element.html() || '';
    const htmlLength = html.length;
    const textToHtmlRatio = htmlLength > 0 ? textLength / htmlLength : 0;
    
    // Presence of headings, paragraphs, lists (more = better)
    const paragraphs = element.find('p').length;
    const headings = element.find('h1, h2, h3, h4, h5, h6').length;
    const listItems = element.find('li').length;
    
    // Fewer links proportional to content (fewer = better)
    const links = element.find('a').length;
    const linkDensity = textLength > 0 ? links * 100 / textLength : 100;
    
    // Score calculation
    let score = (textLength * 0.1) + 
                (paragraphs * 5) + 
                (headings * 10) + 
                (listItems * 2) + 
                (textToHtmlRatio * 20) - 
                (linkDensity * 2);
                
    // Adjust score based on content fingerprints
    for (const fingerprint of this.contentFingerprints) {
      if (element.is(fingerprint.selector) || element.find(fingerprint.selector).length > 0) {
        score += fingerprint.weight;
      }
    }
    
    return score;
  }
  
  /**
   * Check if an element contains rich content
   */
  private isContentRich(element: any): boolean {
    const text = element.text().trim();
    const paragraphs = element.find('p').length;
    const headings = element.find('h1, h2, h3, h4, h5, h6').length;
    
    // Consider content rich if it has significant text and some structure
    return text.length > 250 || (paragraphs >= 3) || (headings >= 1 && paragraphs >= 1);
  }

  /**
   * Extract content by analyzing text density
   */
  private extractByTextDensity($: cheerio.CheerioAPI): string {
    // Calculate text density for all container elements
    const candidates: {element: any, score: number}[] = [];
    
    $('div, section, article, main').each((_, el) => {
      const $el = $(el);
      
      // Skip if it's likely navigation/sidebar/footer
      if (this.isLikelyNonContent($el)) return;
      
      // Calculate text density (text length / element size)
      const textLength = $el.text().trim().length;
      const numElements = $el.find('*').length;
      const density = numElements > 0 ? textLength / numElements : 0;
      
      // Calculate other quality signals
      const paragraphs = $el.find('p').length;
      const headings = $el.find('h1, h2, h3, h4, h5, h6').length;
      const links = $el.find('a').length;
      const linkDensity = textLength > 0 ? links * 100 / textLength : 100;
      
      // Score based on multiple factors
      const score = (density * 10) + 
                   (paragraphs * 5) + 
                   (headings * 10) - 
                   (linkDensity * 2);
                   
      candidates.push({ element: $el, score });
    });
    
    // Sort by score and take the highest scoring element
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length && candidates[0].score > CONTENT_THRESHOLD) {
      return $('<div>').append(candidates[0].element.clone()).html() || '';
    }
    
    // Fallback to original approach if no good candidate is found
    return $.html();
  }

  /**
   * Content fingerprints to identify real content vs. boilerplate
   */
  private contentFingerprints = [
    { selector: 'article', weight: 10 },
    { selector: '[role="main"]', weight: 9 },
    { selector: '.post-content', weight: 8 },
    { selector: '.entry-content', weight: 8 },
    { selector: 'div > p + p', weight: 5 },  // Multiple paragraphs
    { selector: 'section:has(h1, h2, h3) > p', weight: 7 }, // Section with heading and paragraph
  ];

  /**
   * Check if an element is likely non-content (navigation, sidebar, etc.)
   */
  private isLikelyNonContent(element: any): boolean {
    // Check for signals that indicate non-content
    const classId = (element.attr('class') || '') + ' ' + (element.attr('id') || '');
    const text = element.text().trim();
    
    // Check against common non-content patterns
    const nonContentPatterns = [
      /comment/i, /sidebar/i, /footer/i, /header/i, /nav/i, /menu/i,
      /share/i, /social/i, /widget/i, /banner/i, /ad-/i, /-ad/i
    ];
    
    for (const pattern of nonContentPatterns) {
      if (pattern.test(classId)) return true;
    }
    
    // Check for excessive links
    const linkTextLength = element.find('a').text().length;
    const totalTextLength = text.length;
    if (totalTextLength > 0 && linkTextLength / totalTextLength > 0.5) {
      return true; // More than 50% of text is in links
    }
    
    return false;
  }

  /**
   * Clean up markdown content after conversion
   */
  private cleanMarkdown(markdown: string): string {
    return markdown
      // Normalize newlines first
      .replace(/\r\n/g, '\n')
      
      // Remove leading/trailing whitespace
      .trim()
      
      // Replace repeated blank lines with just two newlines
      .replace(/\n{3,}/g, '\n\n')
      
      // Fix spacing around headings (ensure heading has empty lines around it)
      .replace(/([^\n])\n(#+\s)/g, '$1\n\n$2')
      .replace(/(#+\s[^\n]*)\n([^\n])/g, '$1\n\n$2')
      
      // Improve list formatting
      .replace(/\n(\s*[-*+])\s{2,}/g, '\n$1 ')
      
      // Improve code block formatting
      .replace(/\n```([^`\n]*)\n/g, '\n\n```$1\n')
      .replace(/\n([^`\n]+)```\n/g, '\n$1```\n\n')
      
      // Remove trailing whitespace on lines
      .replace(/[ \t]*$/gm, '')
      
      // Make sure links have spaces from surrounding text when needed
      .replace(/([a-z0-9])(\[[^\]]*\]\([^)]*\))/g, '$1 $2')
      .replace(/(\[[^\]]*\]\([^)]*\))([a-z0-9])/g, '$1 $2')
      
      // Normalize URLs to absolute paths
      .replace(/\]\(([^)]+)\)/g, (match, url) => {
        // Skip URLs that are already absolute or anchors
        if (!url || url.startsWith('http') || url.startsWith('#') || url.startsWith('mailto:')) {
          return match;
        }
        
        if (url.startsWith('/')) {
          return `](${this.baseUrl}${url})`;
        } else {
          return `](${this.baseUrl}/${url})`;
        }
      })
      
      // Fix inconsistent table formatting
      .replace(/\n\s*\|\s*\n/g, '\n|\n')
      
      // Ensure paragraphs are separated by blank lines
      .replace(/([^\n])\n([^\n\s#>*-])/g, '$1\n\n$2')
      
      // Remove "Skip to content" and similar accessibility links
      .replace(/\[Skip to [cC]ontent\]\([^)]*\)/g, '')
      .replace(/\[Skip to main content\]\([^)]*\)/g, '')
      .replace(/\[Skip to navigation\]\([^)]*\)/g, '')
      
      // Remove lines with just whitespace
      .replace(/^\s+$/gm, '')
      
      // Process multi-line links by escaping newlines in link text
      .replace(/\[([^\]\n]{0,200})\n([^\]\n]{0,200})\]/g, '[$1 $2]')
      
      // Final normalization to ensure consistent newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Transform HTML to Markdown
   */
  transform(scraperResponse: ScraperResponse): ScraperResponse {
    try {
      logger.info(`Transforming HTML to Markdown for URL: ${scraperResponse.url}`);
      
      if (!scraperResponse.content) {
        logger.warn('Content is empty, skipping transformation');
        return {
          ...scraperResponse,
          contentType: 'markdown',
          content: ''
        };
      }
      
      // Force content type to html if we're trying to transform it
      if (scraperResponse.contentType !== 'html') {
        logger.warn(`Content type is not HTML (${scraperResponse.contentType}), forcing to HTML for transformation`);
        scraperResponse.contentType = 'html';
      }

      // Count headings in the original content
      const $ = cheerio.load(scraperResponse.content);
      const headingCount = $('h1, h2, h3, h4, h5, h6').length;
      logger.info(`Original HTML contains ${headingCount} headings`);
      
      // Log the first 200 chars of the HTML for debugging
      logger.debug(`First 200 chars of HTML: ${scraperResponse.content.substring(0, 200)}...`);

      // Extract domain from URL for fixing relative links
      try {
        const urlObj = new URL(scraperResponse.url);
        this.baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
      } catch (e) {
        this.baseUrl = ''; // Set a default value if URL parsing fails
      }

      // Pre-clean the HTML - enable main content extraction by default
      const cleanedHtml = this.cleanHtml(scraperResponse.content, true);
      logger.debug(`HTML cleaned successfully. Size: ${cleanedHtml.length} characters`);
      
      // Check if headings were preserved
      const $cleaned = cheerio.load(cleanedHtml);
      const cleanedHeadingCount = $cleaned('h1, h2, h3, h4, h5, h6').length;
      logger.info(`Cleaned HTML contains ${cleanedHeadingCount} headings`);

      // Convert HTML to Markdown
      const markdown = this.turndownService.turndown(cleanedHtml);
      logger.debug(`Raw markdown generated. Size: ${markdown.length} characters`);
      
      // Check for headings in the markdown
      const headingLines = markdown.match(/^#+\s.+$/gm);
      logger.info(`Markdown contains ${headingLines?.length || 0} heading lines`);
      
      // Post-process the markdown
      const cleanedMarkdown = this.cleanMarkdown(markdown);
      logger.debug(`Cleaned markdown. Size: ${cleanedMarkdown.length} characters`);
      
      // Log the first 200 chars of the markdown for debugging
      logger.debug(`First 200 chars of markdown: ${cleanedMarkdown.substring(0, 200)}...`);
      
      // Create a new response with markdown content
      const result: ScraperResponse = {
        ...scraperResponse,
        content: cleanedMarkdown,
        contentType: 'markdown'
      };

      logger.info('HTML to Markdown transformation complete');
      return result;
    } catch (error) {
      logger.error(`Error transforming HTML to Markdown: ${error instanceof Error ? error.message : String(error)}`);
      
      // Return original response with error
      return {
        ...scraperResponse,
        error: `Markdown transformation error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Base URL for fixing relative links
  private baseUrl: string = '';
} 