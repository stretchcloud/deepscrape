"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawl = crawl;
exports.getCrawlStatus = getCrawlStatus;
exports.cancelCrawlJob = cancelCrawlJob;
const uuid_1 = require("uuid");
const logger_1 = require("../../utils/logger");
const crawler_1 = require("../../scraper/crawler");
const redis_service_1 = require("../../services/redis.service");
const queue_service_1 = require("../../services/queue.service");
const file_export_service_1 = require("../../services/file-export.service");
/**
 * Initiate a new crawl job
 */
async function crawl(req, res) {
    try {
        const { url, includePaths, excludePaths, limit = 100, maxDepth = 5, allowBackwardCrawling = false, allowExternalContentLinks = false, allowSubdomains = false, ignoreRobotsTxt = false, regexOnFullURL = false, scrapeOptions = {}, webhook, strategy, useBrowser = false } = req.body;
        // Validate URL
        if (!url) {
            res.status(400).json({ success: false, error: 'URL is required' });
            return;
        }
        // Generate a unique ID for this crawl
        const id = (0, uuid_1.v4)();
        logger_1.logger.info(`Starting crawl ${id} for ${url}`, {
            crawlId: id,
            url,
            includePaths,
            excludePaths,
            limit,
            maxDepth,
            strategy,
            useBrowser
        });
        // Initialize WebCrawler
        const crawler = new crawler_1.WebCrawler({
            jobId: id,
            initialUrl: url,
            includes: includePaths,
            excludes: excludePaths,
            maxCrawledLinks: limit,
            limit,
            maxCrawledDepth: maxDepth,
            allowBackwardCrawling,
            allowExternalContentLinks,
            allowSubdomains,
            ignoreRobotsTxt,
            regexOnFullURL,
            strategy,
            useBrowser,
            deduplicateSimilarUrls: true // Enable URL deduplication by default
        });
        // Try to get robots.txt
        let robotsTxt = '';
        try {
            robotsTxt = await crawler.getRobotsTxt(scrapeOptions.skipTlsVerification || false);
            crawler.importRobotsTxt(robotsTxt);
        }
        catch (error) {
            logger_1.logger.debug('Failed to get robots.txt (this is probably fine!)', { error });
        }
        // Store crawl information in Redis
        await (0, redis_service_1.saveCrawl)(id, {
            url,
            includePaths,
            excludePaths,
            limit,
            maxDepth,
            allowBackwardCrawling,
            allowExternalContentLinks,
            allowSubdomains,
            ignoreRobotsTxt,
            regexOnFullURL,
            strategy,
            useBrowser,
            scrapeOptions,
            robots: robotsTxt
        });
        // Kickoff initial job to start the crawl
        await (0, queue_service_1.addCrawlJobToQueue)(id, {
            url,
            mode: 'kickoff',
            scrapeOptions: {
                ...scrapeOptions,
                useBrowser // Pass browser option to scrape options
            },
            webhook,
        }, 10);
        // Return success response with crawl ID
        const protocol = req.secure ? 'https' : 'http';
        res.status(200).json({
            success: true,
            id,
            url: `${protocol}://${req.get('host')}/api/crawl/${id}`,
            message: 'Crawl initiated successfully. Individual pages will be exported as markdown files.',
            outputDirectory: file_export_service_1.fileExportService.getCrawlOutputDir(id)
        });
    }
    catch (error) {
        logger_1.logger.error('Error initiating crawl', { error });
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
}
/**
 * Get the status of a crawl job
 */
async function getCrawlStatus(req, res) {
    try {
        const { jobId } = req.params;
        const start = req.query.skip ? parseInt(req.query.skip, 10) : 0;
        const end = req.query.limit
            ? start + parseInt(req.query.limit, 10) - 1
            : undefined;
        // Get crawl data
        const storedCrawl = await (0, redis_service_1.getCrawl)(jobId);
        if (!storedCrawl) {
            res.status(404).json({ success: false, error: 'Crawl not found' });
            return;
        }
        // Get all job IDs for this crawl
        const jobIds = await (0, redis_service_1.getCrawlJobs)(jobId);
        // Get job statuses
        const jobStatusPromises = jobIds.map(async (id) => {
            const job = await (0, queue_service_1.getJob)(id);
            return { id, status: job ? await job.getState() : 'unknown' };
        });
        const jobStatuses = await Promise.all(jobStatusPromises);
        // Determine overall status
        const status = storedCrawl.cancelled
            ? 'cancelled'
            : jobStatuses.every(j => j.status === 'completed') && await (0, redis_service_1.isCrawlFinished)(jobId)
                ? 'completed'
                : 'scraping';
        // Get completed jobs data
        const doneCount = await (0, redis_service_1.getCrawlDoneJobsCount)(jobId);
        const doneJobIds = await (0, redis_service_1.getCrawlDoneJobs)(jobId, start, end ?? -1);
        const doneJobs = await (0, queue_service_1.getJobs)(doneJobIds);
        // Get exported files information
        const exportedFiles = await (0, redis_service_1.getExportedFiles)(jobId);
        // Format jobs for response
        const jobs = await Promise.all(doneJobs.map(async (job) => {
            const jobState = await job.getState();
            const returnValue = job.returnvalue;
            // Make sure to include content and contentType at the document level
            let document = returnValue?.document || returnValue;
            // Ensure we keep the content fields if they exist at the top level
            if (returnValue && returnValue.content && !document.content) {
                document.content = returnValue.content;
            }
            if (returnValue && returnValue.contentType && !document.contentType) {
                document.contentType = returnValue.contentType;
            }
            // Log to debug what we're returning
            logger_1.logger.debug(`Job ${job.id} document: ${document ? 'has document' : 'no document'}, ` +
                `content length: ${document?.content?.length || 0}, ` +
                `content type: ${document?.contentType || 'none'}`);
            return {
                id: job.id,
                status: jobState,
                document: document,
                error: job.failedReason
            };
        }));
        res.status(200).json({
            success: true,
            status,
            crawl: storedCrawl,
            jobs,
            count: doneCount,
            exportedFiles: {
                count: exportedFiles.length,
                outputDirectory: file_export_service_1.fileExportService.getCrawlOutputDir(jobId),
                files: exportedFiles.slice(0, 10) // Show first 10 files to avoid huge responses
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting crawl status', { error });
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
}
/**
 * Cancel a running crawl
 */
async function cancelCrawlJob(req, res) {
    try {
        const { jobId } = req.params;
        // Get crawl data
        const storedCrawl = await (0, redis_service_1.getCrawl)(jobId);
        if (!storedCrawl) {
            res.status(404).json({ success: false, error: 'Crawl not found' });
            return;
        }
        // Mark as cancelled
        await (0, redis_service_1.cancelCrawl)(jobId);
        res.status(200).json({ success: true });
    }
    catch (error) {
        logger_1.logger.error('Error cancelling crawl', { error });
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
}
