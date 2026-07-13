import { Job } from 'bullmq';
import { logger } from '../utils/logger';
import { WebCrawler } from './crawler';
import {
  getCrawl,
  markCrawlFinished,
  markCrawlKickoffFinished,
  addExportedFile,
  isCrawlCancelled,
  lockCrawlUrl,
  reserveCrawlPageSlots
} from '../services/redis.service';
import { ScraperManager } from './scraper-manager';
import { fileExportService } from '../services/file-export.service';
import { extractChildLinks, filterChildLinks } from './crawl-links';
import { compositeUrlScore } from './url-scorer';
import { UrlNormalizationService } from '../services/url-normalization.service';
import robotsParser from 'robots-parser';
import axios from 'axios';
import { assertPublicUrl, ssrfSafeRequestConfig } from '../utils/ssrf-guard';

const CRAWLER_USER_AGENT = process.env.USER_AGENT ?? 'DeepScrape/1.0';
const CURRENT_YEAR = new Date().getFullYear();

// Type for the queue function to break circular dependency
type AddJobsToQueueFn = (crawlId: string, jobsData: any[]) => Promise<string[]>;

// Store the queue function to avoid circular import
let addJobsToQueueFn: AddJobsToQueueFn | null = null;

/**
 * Set the queue function to break circular dependency
 */
export function setAddJobsToQueueFn(fn: AddJobsToQueueFn): void {
  addJobsToQueueFn = fn;
}

/**
 * Process a crawl job
 */
export async function processCrawlJob(job: Job): Promise<any> {
  const { url, mode, scrapeOptions, webhook, crawlId, depth } = job.data;

  try {
    logger.info(`Processing ${mode} job for crawl ${crawlId}`, { url, crawlId, jobId: job.id, depth });

    // Honor cancellation: skip work for cancelled crawls (queued jobs drain fast).
    if (await isCrawlCancelled(crawlId)) {
      logger.info(`Crawl ${crawlId} is cancelled — skipping ${mode} job for ${url}`);
      return { url, cancelled: true, links: [], discoveredCount: 0 };
    }

    // Handle different job modes
    if (mode === 'kickoff') {
      // This is the initial job that starts the crawl
      return await handleCrawlKickoff(crawlId, url, scrapeOptions);
    } else if (mode === 'page') {
      // Scrape a page and (if allowed) recurse into its child links.
      return await handlePageScrape(url, scrapeOptions, crawlId, depth ?? 0, true);
    } else if (mode === 'streaming-initial' || mode === 'streaming-discovered') {
      // Streaming jobs scrape + export immediately; discovery already happened,
      // so they do not recurse.
      logger.info(`Processing streaming job (${mode}) for crawl ${crawlId}`, {
        url,
        discoveryMethod: scrapeOptions.discoveryMethod,
        streamingDiscovery: scrapeOptions.streamingDiscovery
      });
      return await handlePageScrape(url, scrapeOptions, crawlId, 0, false);
    } else {
      throw new Error(`Unknown job mode: ${mode}`);
    }
  } catch (error: any) {
    logger.error(`Error processing crawl job: ${error.message}`, { error, url, crawlId, jobId: job.id });

    // If this was the kickoff job, we need to mark the crawl as finished to prevent it from hanging
    if (mode === 'kickoff') {
      await markCrawlFinished(crawlId);
    }

    // Send webhook if configured
    if (webhook) {
      try {
        await assertPublicUrl(webhook);
        await axios.post(webhook, {
          success: false,
          crawlId,
          url,
          error: error.message
        }, {
          timeout: 10000,
          maxContentLength: 1024 * 1024,
          ...ssrfSafeRequestConfig()
        });
      } catch (webhookError) {
        logger.error('Failed to send webhook notification', { error: webhookError, webhook });
      }
    }

    throw error;
  }
}

/**
 * Handle the kickoff job that starts a crawl.
 *
 * Two modes:
 *  - Browser discovery (useBrowser): discover the full URL set up-front and
 *    enqueue each as a non-recursing page job (discovery already found them all).
 *  - Recursive (default): enqueue only the seed URL as a depth-0 page job; each
 *    page job then discovers and enqueues its own in-domain children. This is
 *    what actually makes maxDepth work (previously the crawl was always depth-1).
 *
 * In both modes we mark kickoff-finished at the end so completion detection can
 * only fire after the initial jobs have been registered.
 */
async function handleCrawlKickoff(crawlId: string, url: string, scrapeOptions: any): Promise<any> {
  const crawl = await getCrawl(crawlId);
  if (!crawl) {
    throw new Error(`Crawl ${crawlId} not found`);
  }

  const opts = crawl.crawlerOptions || {};
  const limit = opts.limit || 100;
  const maxDepth = opts.maxDepth ?? 3;
  const useBrowser = opts.useBrowser || false;

  if (!addJobsToQueueFn) {
    throw new Error('Queue function not initialized. Call setAddJobsToQueueFn first.');
  }

  // Always claim the seed so a child that links back to it isn't re-enqueued.
  await lockCrawlUrl(crawlId, UrlNormalizationService.normalizeUrl(url));

  let enqueuedCount = 0;

  try {
    if (useBrowser) {
      // Browser-based discovery: find everything up-front, then enqueue.
      const crawler = new WebCrawler({
        jobId: crawlId,
        initialUrl: url,
        baseUrl: new URL(url).origin,
        includes: opts.includePaths,
        excludes: opts.excludePaths,
        maxCrawledLinks: limit,
        limit,
        maxCrawledDepth: maxDepth,
        allowBackwardCrawling: opts.allowBackwardCrawling,
        allowExternalContentLinks: opts.allowExternalContentLinks,
        allowSubdomains: opts.allowSubdomains,
        ignoreRobotsTxt: opts.ignoreRobotsTxt,
        regexOnFullURL: opts.regexOnFullURL,
        strategy: opts.strategy,
        hooks: {},
        useBrowser: true,
        deduplicateSimilarUrls: true
      });
      if (crawl.robots) crawler.importRobotsTxt(crawl.robots);

      let discovered: string[] = [];
      try {
        discovered = await crawler.discoverUrlsWithBrowser(maxDepth, limit);
      } catch (error) {
        logger.error(`Browser discovery failed for ${url}, falling back to seed-only crawl`, { error, crawlId });
      } finally {
        await crawler.close();
      }

      // Dedup + budget, enqueue discovered links as non-recursing page jobs.
      const fresh: string[] = [];
      for (const link of discovered) {
        const norm = UrlNormalizationService.normalizeUrl(link);
        if (await lockCrawlUrl(crawlId, norm)) fresh.push(link);
      }
      const granted = await reserveCrawlPageSlots(crawlId, fresh.length, limit);
      const toEnqueue = fresh.slice(0, granted);
      if (toEnqueue.length > 0) {
        await addJobsToQueueFn(crawlId, toEnqueue.map(link => ({
          url: link,
          mode: 'page',
          depth: maxDepth, // already fully discovered — do not recurse further
          scrapeOptions: { ...scrapeOptions, extractorFormat: scrapeOptions.extractorFormat || 'markdown', useBrowser: true }
        })));
      }
      enqueuedCount = toEnqueue.length;
    } else {
      // Recursive mode: enqueue just the seed at depth 0; recursion happens in
      // the page jobs. Reserve one budget slot for the seed.
      await reserveCrawlPageSlots(crawlId, 1, limit);
      await addJobsToQueueFn(crawlId, [{
        url,
        mode: 'page',
        depth: 0,
        scrapeOptions: { ...scrapeOptions, extractorFormat: scrapeOptions.extractorFormat || 'markdown', useBrowser: false }
      }]);
      enqueuedCount = 1;
    }
  } finally {
    // Kickoff is done enqueuing initial jobs — allow completion detection.
    await markCrawlKickoffFinished(crawlId);
  }

  logger.info(`Crawl ${crawlId} kickoff complete — enqueued ${enqueuedCount} initial job(s)`, {
    crawlId, initialUrl: url, maxDepth, limit, useBrowser,
    outputDir: fileExportService.getCrawlOutputDir(crawlId)
  });

  return {
    url,
    links: [],
    discoveredCount: enqueuedCount,
    usedBrowser: useBrowser,
    outputDirectory: fileExportService.getCrawlOutputDir(crawlId)
  };
}

/**
 * Build enhanced scraping options based on input options and browser usage
 */
function buildEnhancedScrapeOptions(scrapeOptions: any, useBrowser: boolean, includeRawHtml: boolean): any {
  return {
    ...scrapeOptions,
    extractorFormat: scrapeOptions.extractorFormat || 'markdown',
    skipCache: false,
    onlyMainContent: scrapeOptions.onlyMainContent !== false,
    // Needed so we can discover child links without a second fetch.
    includeRawHtml,
    waitForTimeout: scrapeOptions.waitForTimeout || 2000,
    useBrowser: useBrowser,
    stealthMode: useBrowser ? true : undefined,
    blockResources: useBrowser ? true : undefined,
    maxScrolls: useBrowser ? 3 : undefined,
    minDelay: useBrowser ? 3000 : undefined,
    maxDelay: useBrowser ? 30000 : undefined,
    maxRetries: useBrowser ? 3 : undefined,
    backoffFactor: useBrowser ? 2 : undefined,
    rotateUserAgent: useBrowser ? true : undefined
  };
}

/**
 * Discover and enqueue in-domain child links from a scraped page. Uses the
 * atomic Redis visited-set (lockCrawlUrl) for dedup and the page budget
 * (reserveCrawlPageSlots) so the crawl can never exceed its limit. Returns the
 * number of children enqueued.
 */
async function discoverAndEnqueueChildren(
  crawlId: string,
  pageUrl: string,
  rawHtml: string,
  depth: number,
  crawlOpts: any,
  scrapeOptions: any
): Promise<number> {
  if (!addJobsToQueueFn) return 0;

  const limit = crawlOpts.limit || 100;
  const rawLinks = extractChildLinks(rawHtml, pageUrl);
  let filtered = filterChildLinks(rawLinks, {
    seedUrl: crawlOpts.originUrl || pageUrl,
    allowSubdomains: crawlOpts.allowSubdomains,
    allowExternalLinks: crawlOpts.allowExternalContentLinks,
    includePaths: crawlOpts.includePaths,
    excludePaths: crawlOpts.excludePaths,
    regexOnFullURL: crawlOpts.regexOnFullURL
  });

  // Honor robots.txt in the recursive crawl path (previously only the HTTP
  // kickoff respected it). Skipped when ignoreRobotsTxt is set.
  if (crawlOpts.robots && !crawlOpts.ignoreRobotsTxt) {
    try {
      const robots = robotsParser(crawlOpts.originUrl || pageUrl, crawlOpts.robots);
      filtered = filtered.filter(link => robots.isAllowed(link, CRAWLER_USER_AGENT) !== false);
    } catch {
      /* malformed robots -> don't block crawling */
    }
  }

  // Atomically claim each normalized URL; only newly-claimed ones are candidates.
  let fresh: string[] = [];
  for (const link of filtered) {
    const norm = UrlNormalizationService.normalizeUrl(link);
    if (await lockCrawlUrl(crawlId, norm)) fresh.push(link);
  }
  if (fresh.length === 0) return 0;

  // Best-first: when the budget can't take every candidate, crawl the most
  // relevant first by scoring URLs (keyword / path-depth / freshness).
  if ((crawlOpts.strategy === 'best_first' || crawlOpts.keywords?.length) && fresh.length > 1) {
    fresh = [...fresh].sort((a, b) =>
      compositeUrlScore(b, { keywords: crawlOpts.keywords, currentYear: CURRENT_YEAR }) -
      compositeUrlScore(a, { keywords: crawlOpts.keywords, currentYear: CURRENT_YEAR })
    );
  }

  const granted = await reserveCrawlPageSlots(crawlId, fresh.length, limit);
  const toEnqueue = fresh.slice(0, granted);
  if (toEnqueue.length === 0) return 0;

  await addJobsToQueueFn(crawlId, toEnqueue.map(link => ({
    url: link,
    mode: 'page',
    depth: depth + 1,
    scrapeOptions: { ...scrapeOptions, extractorFormat: scrapeOptions.extractorFormat || 'markdown' }
  })));

  logger.info(`Crawl ${crawlId}: enqueued ${toEnqueue.length} child link(s) at depth ${depth + 1} from ${pageUrl}`);
  return toEnqueue.length;
}

/**
 * Extract original HTML from scrape result. Prefers the rawHtml captured by the
 * scraper (set when includeRawHtml is requested), falling back to html content.
 */
function extractOriginalHtml(result: any): string | null {
  if (result.rawHtml) return result.rawHtml;
  return result.contentType === 'html' ? result.content : null;
}

/**
 * Export page content to file and track it
 */
async function exportPageContent(
  url: string,
  result: any,
  crawlId: string,
  useBrowser: boolean,
  isStreaming: boolean = false,
  discoveryMethod?: string
): Promise<void> {
  if (!result.content || result.contentType !== 'markdown') {
    logger.debug(`Skipping export for ${url} - no markdown content`, { crawlId, contentType: result.contentType });
    return;
  }

  try {
    const exportedFilePath = await fileExportService.exportPage(
      url,
      result.content,
      result.title || 'Untitled',
      crawlId,
      {
        status: result.metadata?.status,
        contentType: result.contentType,
        loadTime: result.metadata?.loadTime,
        usedBrowser: useBrowser,
        processingTime: result.metadata?.processingTime,
        timestamp: new Date().toISOString(),
        isStreaming,
        discoveryMethod
      }
    );

    await addExportedFile(crawlId, exportedFilePath);

    const logMessage = isStreaming
      ? `🚀 STREAMING: Page exported to file in real-time: ${exportedFilePath}`
      : `Page exported to file: ${exportedFilePath}`;

    logger.info(logMessage, {
      url,
      crawlId,
      contentLength: result.content.length,
      isStreaming,
      discoveryMethod,
      filePath: exportedFilePath
    });
  } catch (exportError) {
    logger.error(`Failed to export page to file: ${url}`, {
      error: exportError,
      crawlId
    });
  }
}

/**
 * Build the response object for scraped page
 */
function buildPageScrapeResponse(result: any, originalHtml: string | null, useBrowser: boolean): any {
  const baseResponse = {
    url: result.url,
    title: result.title,
    html: originalHtml,
    content: result.content,
    contentType: result.contentType,
    links: [],
    discoveredCount: 0,
    metadata: {
      ...result.metadata,
      usedBrowser: useBrowser
    }
  };

  return {
    ...baseResponse,
    document: { ...baseResponse }
  };
}

/**
 * Handle scraping of an individual page during crawling. When `recurse` is true
 * and the page is below maxDepth, discovers and enqueues its in-domain children.
 */
async function handlePageScrape(
  url: string,
  scrapeOptions: any,
  crawlId: string,
  depth: number,
  recurse: boolean
): Promise<any> {
  const scraperManager = new ScraperManager();
  const useBrowser = scrapeOptions.useBrowser === true;

  // Decide up-front whether this page may recurse, so we only pay the cost of
  // capturing raw HTML when we actually need it for link discovery.
  const crawl = recurse ? await getCrawl(crawlId) : null;
  const maxDepth = crawl?.crawlerOptions?.maxDepth ?? 0;
  const willRecurse = recurse && crawl != null && depth < maxDepth;

  logger.info(`Crawl ${crawlId}: Scraping page ${url} (depth ${depth}) using ${useBrowser ? 'browser' : 'standard'} approach`);

  const enhancedOptions = buildEnhancedScrapeOptions(scrapeOptions, useBrowser, willRecurse);
  const result = await scraperManager.scrape(url, enhancedOptions);

  // scrape() catches transport/HTTP/DNS failures internally and returns a
  // response with `error` set rather than throwing. Surface it as a failed job
  // so the page is recorded in the crawl's error list (and not miscounted as a
  // successfully scraped page). Each URL is its own job, so this fails only this
  // page — the crawl continues with the rest.
  if (result.error) {
    throw new Error(result.error);
  }

  logger.info(`Crawl ${crawlId}: Completed scraping page ${url}`, {
    contentLength: result.content?.length || 0,
    contentType: result.contentType,
    status: result.metadata?.status,
    usedBrowser: useBrowser
  });

  const originalHtml = extractOriginalHtml(result);

  // Determine if this is a streaming job and get discovery method
  const isStreaming = scrapeOptions.streamingDiscovery === true;
  const discoveryMethod = scrapeOptions.discoveryMethod;

  await exportPageContent(url, result, crawlId, useBrowser, isStreaming, discoveryMethod);

  // Recurse into child links (bounded by depth, budget, dedup, same-domain).
  let discoveredCount = 0;
  if (willRecurse && !result.error && originalHtml && crawl) {
    try {
      discoveredCount = await discoverAndEnqueueChildren(
        crawlId,
        url,
        originalHtml,
        depth,
        { ...crawl.crawlerOptions, originUrl: crawl.originUrl, robots: crawl.robots },
        scrapeOptions
      );
    } catch (err) {
      logger.error(`Crawl ${crawlId}: child discovery failed for ${url}: ${(err as Error).message}`);
    }
  }

  const response = buildPageScrapeResponse(result, originalHtml, useBrowser);
  response.discoveredCount = discoveredCount;
  response.document.discoveredCount = discoveredCount;
  return response;
}
