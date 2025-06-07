"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCrawlJob = processCrawlJob;
const logger_1 = require("../utils/logger");
const crawler_1 = require("./crawler");
const redis_service_1 = require("../services/redis.service");
const queue_service_1 = require("../services/queue.service");
const scraper_manager_1 = require("./scraper-manager");
const axios_1 = __importDefault(require("axios"));
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
        useBrowser: crawl.crawlerOptions.useBrowser || false,
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
        useBrowser: crawl.crawlerOptions.useBrowser || false
    });
    let filteredLinks = [];
    // If using browser, use browser-based URL discovery
    if (crawl.crawlerOptions.useBrowser) {
        logger_1.logger.info(`Using browser-based discovery for crawl ${crawlId}`);
        // Use browser-based discovery
        try {
            filteredLinks = await crawler.discoverUrlsWithBrowser(crawl.crawlerOptions.maxDepth || 5, crawl.crawlerOptions.limit || 100);
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
            filteredLinks = crawler.filterLinks(result.links, crawl.crawlerOptions.limit || 100, crawl.crawlerOptions.maxDepth || 5);
        }
    }
    else {
        // Use regular crawling
        const { html, links } = await crawler.crawlPage(url, scrapeOptions.skipTlsVerification);
        // Filter links based on crawler options
        filteredLinks = crawler.filterLinks(links, crawl.crawlerOptions.limit || 100, crawl.crawlerOptions.maxDepth || 5);
    }
    // Create jobs for each discovered URL
    const jobsData = filteredLinks.map(link => ({
        url: link,
        mode: 'page',
        scrapeOptions: {
            ...scrapeOptions,
            // Ensure extractorFormat is set to markdown for consistent processing
            extractorFormat: scrapeOptions.extractorFormat || 'markdown',
            // If we're using browser mode, pass that to each page job
            useBrowser: crawl.crawlerOptions.useBrowser || false
        }
    }));
    // Add jobs to the queue
    const jobIds = await (0, queue_service_1.addCrawlJobsToQueue)(crawlId, jobsData);
    // Track jobs in Redis
    await (0, redis_service_1.addCrawlJobs)(crawlId, jobIds);
    // Ensure to close browser if we used it
    if (crawl.crawlerOptions.useBrowser) {
        await crawler.close();
    }
    // Return discovery result
    return {
        url,
        links: filteredLinks,
        discoveredCount: filteredLinks.length,
        strategy: crawler.getStrategy(),
        usedBrowser: crawl.crawlerOptions.useBrowser || false
    };
}
/**
 * Handle scraping of an individual page during crawling
 */
async function handlePageScrape(url, scrapeOptions, crawlId) {
    // Create scraper manager instance
    const scraperManager = new scraper_manager_1.ScraperManager();
    // Check if we should use browser-based scraping
    const useBrowser = scrapeOptions.useBrowser === true;
    // Log scraping approach
    logger_1.logger.info(`Crawl ${crawlId}: Scraping page ${url} using ${useBrowser ? 'browser-based' : 'standard'} approach`);
    // Ensure we have the correct options for consistent processing
    const enhancedOptions = {
        ...scrapeOptions,
        // Default to markdown format for consistent processing across all pages
        extractorFormat: scrapeOptions.extractorFormat || 'markdown',
        // Enable caching for crawled pages
        skipCache: false,
        // Run content cleaning
        onlyMainContent: scrapeOptions.onlyMainContent !== false, // Default to true if not specified
        // Add any additional options needed for thorough processing
        waitForTimeout: scrapeOptions.waitForTimeout || 2000, // Give pages time to load
        // Browser options
        useBrowser: useBrowser,
        stealthMode: useBrowser ? true : undefined,
        blockResources: useBrowser ? true : undefined,
        maxScrolls: useBrowser ? 3 : undefined,
        // Rate limiting options for browser
        minDelay: useBrowser ? 3000 : undefined, // Minimum 3 seconds between requests
        maxDelay: useBrowser ? 30000 : undefined, // Maximum 30 seconds for backoff
        maxRetries: useBrowser ? 3 : undefined, // Try up to 3 times
        backoffFactor: useBrowser ? 2 : undefined, // Double the delay on each retry
        rotateUserAgent: useBrowser ? true : undefined // Rotate user agents on retry
    };
    // Perform the scrape with enhanced options
    const result = await scraperManager.scrape(url, enhancedOptions);
    // Log the completion of this page's scraping
    logger_1.logger.info(`Crawl ${crawlId}: Completed scraping page ${url}`, {
        contentLength: result.content?.length || 0,
        contentType: result.contentType,
        status: result.metadata?.status,
        usedBrowser: useBrowser
    });
    // Store the original HTML if we're in markdown mode, we need to preserve it
    const originalHtml = result.contentType === 'markdown' && result.metadata?.originalHtml
        ? result.metadata.originalHtml
        : (result.contentType === 'html' ? result.content : null);
    // Make sure to log the content we're returning
    logger_1.logger.info(`Returning content for ${url}, type: ${result.contentType}, length: ${result.content?.length || 0}`);
    // Return both a document structure AND the content directly
    // This ensures the content is accessible in the crawler API response
    return {
        // Document structure for consistent API
        url: result.url,
        title: result.title,
        html: originalHtml,
        // Content must be accessible at the top level AND in document
        content: result.content,
        contentType: result.contentType,
        links: [],
        discoveredCount: 0,
        metadata: {
            ...result.metadata,
            usedBrowser: useBrowser
        },
        // Also include a document property with the same content for backwards compatibility
        document: {
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
        }
    };
}
