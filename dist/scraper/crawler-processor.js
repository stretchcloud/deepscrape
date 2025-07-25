"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAddJobsToQueueFn = setAddJobsToQueueFn;
exports.processCrawlJob = processCrawlJob;
const logger_1 = require("../utils/logger");
const crawler_1 = require("./crawler");
const redis_service_1 = require("../services/redis.service");
const scraper_manager_1 = require("./scraper-manager");
const file_export_service_1 = require("../services/file-export.service");
const axios_1 = __importDefault(require("axios"));
// Store the queue function to avoid circular import
let addJobsToQueueFn = null;
/**
 * Set the queue function to break circular dependency
 */
function setAddJobsToQueueFn(fn) {
    addJobsToQueueFn = fn;
}
/**
 * Process a crawl job
 */
async function processCrawlJob(job) {
    const { url, mode, scrapeOptions, webhook, crawlId } = job.data;
    try {
        logger_1.logger.info(`Processing ${mode} job for crawl ${crawlId}`, { url, crawlId, jobId: job.id });
        // Handle different job modes
        if (mode === 'kickoff') {
            // This is the initial job that starts the crawl
            return await handleCrawlKickoff(crawlId, url, scrapeOptions);
        }
        else if (mode === 'page') {
            // This is a job to scrape a specific page
            return await handlePageScrape(url, scrapeOptions, crawlId);
        }
        else {
            throw new Error(`Unknown job mode: ${mode}`);
        }
    }
    catch (error) {
        logger_1.logger.error(`Error processing crawl job: ${error.message}`, { error, url, crawlId, jobId: job.id });
        // If this was the kickoff job, we need to mark the crawl as finished to prevent it from hanging
        if (mode === 'kickoff') {
            await (0, redis_service_1.markCrawlFinished)(crawlId);
        }
        // Send webhook if configured
        if (webhook) {
            try {
                await axios_1.default.post(webhook, {
                    success: false,
                    crawlId,
                    url,
                    error: error.message
                });
            }
            catch (webhookError) {
                logger_1.logger.error('Failed to send webhook notification', { error: webhookError, webhook });
            }
        }
        throw error;
    }
}
/**
 * Handle the kickoff job that starts a crawl
 */
async function handleCrawlKickoff(crawlId, url, scrapeOptions) {
    // Get the stored crawl information
    const crawl = await (0, redis_service_1.getCrawl)(crawlId);
    if (!crawl) {
        throw new Error(`Crawl ${crawlId} not found`);
    }
    // Initialize the crawler with strategy if specified
    const crawler = new crawler_1.WebCrawler({
        jobId: crawlId,
        initialUrl: url,
        baseUrl: new URL(url).origin,
        includes: crawl.crawlerOptions.includePaths,
        excludes: crawl.crawlerOptions.excludePaths,
        maxCrawledLinks: crawl.crawlerOptions.limit,
        limit: crawl.crawlerOptions.limit,
        maxCrawledDepth: crawl.crawlerOptions.maxDepth,
        allowBackwardCrawling: crawl.crawlerOptions.allowBackwardCrawling,
        allowExternalContentLinks: crawl.crawlerOptions.allowExternalContentLinks,
        allowSubdomains: crawl.crawlerOptions.allowSubdomains,
        ignoreRobotsTxt: crawl.crawlerOptions.ignoreRobotsTxt,
        regexOnFullURL: crawl.crawlerOptions.regexOnFullURL,
        // Use the strategy from the crawl options if available
        strategy: crawl.crawlerOptions.strategy,
        // Setup hooks if needed - for now we'll just use the default empty object
        hooks: {},
        // Use browser-based crawling if specified
        useBrowser: crawl.crawlerOptions.useBrowser ?? false,
        // Enable URL deduplication by default
        deduplicateSimilarUrls: true
    });
    // Import robots.txt if it was previously fetched
    if (crawl.robots) {
        crawler.importRobotsTxt(crawl.robots);
    }
    logger_1.logger.info(`Starting crawl with strategy: ${crawler.getStrategy()}`, {
        crawlId,
        url,
        strategy: crawler.getStrategy(),
        useBrowser: crawl.crawlerOptions.useBrowser ?? false
    });
    let filteredLinks = [];
    // If using browser, use browser-based URL discovery
    if (crawl.crawlerOptions.useBrowser) {
        logger_1.logger.info(`Using browser-based discovery for crawl ${crawlId}`);
        // Use browser-based discovery
        try {
            filteredLinks = await crawler.discoverUrlsWithBrowser(crawl.crawlerOptions.maxDepth ?? 5, crawl.crawlerOptions.limit ?? 100);
            logger_1.logger.info(`Browser-based discovery completed for ${url}. Found ${filteredLinks.length} URLs`, {
                crawlId,
                discoveredCount: filteredLinks.length
            });
        }
        catch (error) {
            logger_1.logger.error(`Error during browser-based discovery: ${error}`, {
                error,
                crawlId,
                url
            });
            // Fallback to regular crawling on error
            logger_1.logger.info(`Falling back to regular crawling for ${url}`);
            const result = await crawler.crawlPage(url, scrapeOptions.skipTlsVerification);
            filteredLinks = crawler.filterLinks(result.links, crawl.crawlerOptions.limit ?? 100, crawl.crawlerOptions.maxDepth ?? 5);
        }
    }
    else {
        // Use regular crawling
        const { links } = await crawler.crawlPage(url, scrapeOptions.skipTlsVerification);
        // Filter links based on crawler options
        filteredLinks = crawler.filterLinks(links, crawl.crawlerOptions.limit ?? 100, crawl.crawlerOptions.maxDepth ?? 5);
    }
    // Create jobs for each discovered URL
    const jobsData = filteredLinks.map(link => ({
        url: link,
        mode: 'page',
        scrapeOptions: {
            ...scrapeOptions,
            // Ensure extractorFormat is set to markdown for consistent processing
            extractorFormat: scrapeOptions.extractorFormat ?? 'markdown',
            // If we're using browser mode, pass that to each page job
            useBrowser: crawl.crawlerOptions.useBrowser ?? false
        }
    }));
    // Add jobs to the queue using injected function
    if (!addJobsToQueueFn) {
        throw new Error('Queue function not initialized. Call setAddJobsToQueueFn first.');
    }
    const jobIds = await addJobsToQueueFn(crawlId, jobsData);
    // Track jobs in Redis
    await (0, redis_service_1.addCrawlJobs)(crawlId, jobIds);
    // Ensure to close browser if we used it
    if (crawl.crawlerOptions.useBrowser) {
        await crawler.close();
    }
    // Log crawl initiation for summary tracking
    logger_1.logger.info(`Crawl ${crawlId} initiated - discovered ${filteredLinks.length} URLs to process`, {
        crawlId,
        initialUrl: url,
        discoveredCount: filteredLinks.length,
        strategy: crawler.getStrategy(),
        usedBrowser: crawl.crawlerOptions.useBrowser ?? false,
        outputDir: file_export_service_1.fileExportService.getCrawlOutputDir(crawlId)
    });
    // Return discovery result
    return {
        url,
        links: filteredLinks,
        discoveredCount: filteredLinks.length,
        strategy: crawler.getStrategy(),
        usedBrowser: crawl.crawlerOptions.useBrowser ?? false,
        outputDirectory: file_export_service_1.fileExportService.getCrawlOutputDir(crawlId)
    };
}
/**
 * Build enhanced scraping options based on input options and browser usage
 */
function buildEnhancedScrapeOptions(scrapeOptions, useBrowser) {
    return {
        ...scrapeOptions,
        extractorFormat: scrapeOptions.extractorFormat ?? 'markdown',
        skipCache: false,
        onlyMainContent: scrapeOptions.onlyMainContent !== false,
        waitForTimeout: scrapeOptions.waitForTimeout ?? 2000,
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
 * Extract original HTML from scrape result
 */
function extractOriginalHtml(result) {
    if (result.contentType === 'markdown' && result.metadata?.originalHtml) {
        return result.metadata.originalHtml;
    }
    else if (result.contentType === 'html') {
        return result.content;
    }
    else {
        return null;
    }
}
/**
 * Export page content to file and track it
 */
async function exportPageContent(url, result, crawlId, useBrowser) {
    if (!result.content || result.contentType !== 'markdown') {
        return;
    }
    try {
        const exportedFilePath = await file_export_service_1.fileExportService.exportPage(url, result.content, result.title ?? 'Untitled', crawlId, {
            status: result.metadata?.status,
            contentType: result.contentType,
            loadTime: result.metadata?.loadTime,
            usedBrowser: useBrowser,
            processingTime: result.metadata?.processingTime,
            timestamp: new Date().toISOString()
        });
        await (0, redis_service_1.addExportedFile)(crawlId, exportedFilePath);
        logger_1.logger.info(`Page exported to file: ${exportedFilePath}`, {
            url,
            crawlId,
            contentLength: result.content.length
        });
    }
    catch (exportError) {
        logger_1.logger.error(`Failed to export page to file: ${url}`, {
            error: exportError,
            crawlId
        });
    }
}
/**
 * Build the response object for scraped page
 */
function buildPageScrapeResponse(result, originalHtml, useBrowser) {
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
 * Handle scraping of an individual page during crawling
 */
async function handlePageScrape(url, scrapeOptions, crawlId) {
    const scraperManager = new scraper_manager_1.ScraperManager();
    const useBrowser = scrapeOptions.useBrowser === true;
    logger_1.logger.info(`Crawl ${crawlId}: Scraping page ${url} using ${useBrowser ? 'browser-based' : 'standard'} approach`);
    const enhancedOptions = buildEnhancedScrapeOptions(scrapeOptions, useBrowser);
    const result = await scraperManager.scrape(url, enhancedOptions);
    logger_1.logger.info(`Crawl ${crawlId}: Completed scraping page ${url}`, {
        contentLength: result.content?.length ?? 0,
        contentType: result.contentType,
        status: result.metadata?.status,
        usedBrowser: useBrowser
    });
    const originalHtml = extractOriginalHtml(result);
    logger_1.logger.info(`Returning content for ${url}, type: ${result.contentType}, length: ${result.content?.length ?? 0}`);
    await exportPageContent(url, result, crawlId, useBrowser);
    return buildPageScrapeResponse(result, originalHtml, useBrowser);
}
