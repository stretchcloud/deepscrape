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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisClient = void 0;
exports.saveCrawl = saveCrawl;
exports.getCrawl = getCrawl;
exports.addCrawlJob = addCrawlJob;
exports.addCrawlJobs = addCrawlJobs;
exports.getCrawlJobs = getCrawlJobs;
exports.markCrawlJobDone = markCrawlJobDone;
exports.getCrawlDoneJobs = getCrawlDoneJobs;
exports.getCrawlDoneJobsCount = getCrawlDoneJobsCount;
exports.markCrawlFinished = markCrawlFinished;
exports.isCrawlFinished = isCrawlFinished;
exports.cancelCrawl = cancelCrawl;
exports.addExportedFile = addExportedFile;
exports.getExportedFiles = getExportedFiles;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
// Connect to Redis using the Docker configuration
const redisClient = new ioredis_1.default({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379')
});
exports.redisClient = redisClient;
redisClient.on('error', (err) => {
    logger_1.logger.error('Redis connection error', { error: err });
});
redisClient.on('connect', () => {
    logger_1.logger.info('Connected to Redis');
});
// Crawl data operations
async function saveCrawl(id, data) {
    const storedCrawl = {
        originUrl: data.url,
        crawlerOptions: {
            includePaths: data.includePaths,
            excludePaths: data.excludePaths,
            limit: data.limit,
            maxDepth: data.maxDepth,
            allowBackwardCrawling: data.allowBackwardCrawling,
            allowExternalContentLinks: data.allowExternalContentLinks,
            allowSubdomains: data.allowSubdomains,
            ignoreRobotsTxt: data.ignoreRobotsTxt,
            regexOnFullURL: data.regexOnFullURL,
            strategy: data.strategy,
            useBrowser: data.useBrowser
        },
        scrapeOptions: data.scrapeOptions ?? {},
        createdAt: Date.now(),
        robots: data.robots
    };
    await redisClient.set(`crawl:${id}`, JSON.stringify(storedCrawl));
}
async function getCrawl(id) {
    try {
        const data = await redisClient.get(`crawl:${id}`);
        if (!data)
            return null;
        // Refresh TTL
        await redisClient.expire(`crawl:${id}`, 24 * 60 * 60);
        return JSON.parse(data);
    }
    catch (error) {
        logger_1.logger.error('Error retrieving crawl data', { error, crawlId: id });
        throw error;
    }
}
async function addCrawlJob(crawlId, jobId) {
    try {
        await redisClient.sadd(`crawl:${crawlId}:jobs`, jobId);
        await redisClient.expire(`crawl:${crawlId}:jobs`, 24 * 60 * 60);
    }
    catch (error) {
        logger_1.logger.error('Error adding crawl job', { error, crawlId, jobId });
        throw error;
    }
}
async function addCrawlJobs(crawlId, jobIds) {
    if (jobIds.length === 0)
        return;
    try {
        await redisClient.sadd(`crawl:${crawlId}:jobs`, ...jobIds);
        await redisClient.expire(`crawl:${crawlId}:jobs`, 24 * 60 * 60);
    }
    catch (error) {
        logger_1.logger.error('Error adding crawl jobs', { error, crawlId, jobIds });
        throw error;
    }
}
async function getCrawlJobs(crawlId) {
    try {
        return await redisClient.smembers(`crawl:${crawlId}:jobs`);
    }
    catch (error) {
        logger_1.logger.error('Error getting crawl jobs', { error, crawlId });
        throw error;
    }
}
// Mark a job as done in Redis and store its result
async function markCrawlJobDone(crawlId, jobId, success, result = null) {
    try {
        // Add to appropriate set based on success/failure
        if (success) {
            await redisClient.sadd(`crawl:${crawlId}:jobs:done:success`, jobId);
        }
        else {
            await redisClient.sadd(`crawl:${crawlId}:jobs:done:failed`, jobId);
        }
        // If we have a result, store it separately
        if (result) {
            // Store the full job result in Redis
            await redisClient.set(`crawl:${crawlId}:job:${jobId}:result`, JSON.stringify(result));
            // Set expiration separately
            await redisClient.expire(`crawl:${crawlId}:job:${jobId}:result`, 86400); // 24 hours
        }
        // Remove from pending
        await redisClient.srem(`crawl:${crawlId}:jobs:pending`, jobId);
        // Check if all jobs are completed
        const pendingCount = await redisClient.scard(`crawl:${crawlId}:jobs:pending`);
        // If no more pending jobs, mark crawl as finished
        if (pendingCount === 0) {
            await markCrawlFinished(crawlId);
        }
    }
    catch (error) {
        logger_1.logger.error('Error marking job as done in Redis', { error, crawlId, jobId });
        throw error;
    }
}
async function getCrawlDoneJobs(crawlId, start = 0, end = -1) {
    try {
        // First try the new format
        const successJobs = await redisClient.smembers(`crawl:${crawlId}:jobs:done:success`);
        // If we have success jobs, convert the set to an array and handle pagination
        if (successJobs.length > 0) {
            // Apply pagination manually since Redis sets don't support range slicing
            let paginatedJobs;
            if (start === 0 && end === -1) {
                paginatedJobs = successJobs;
            }
            else {
                const endIndex = end === -1 ? undefined : end + 1;
                paginatedJobs = successJobs.slice(start, endIndex);
            }
            logger_1.logger.debug(`Found ${successJobs.length} completed jobs for crawl ${crawlId}, returning ${paginatedJobs.length}`);
            return paginatedJobs;
        }
        // Fallback to old format
        logger_1.logger.debug(`No jobs found in new format, trying old format for crawl ${crawlId}`);
        await redisClient.expire(`crawl:${crawlId}:jobs_done_ordered`, 24 * 60 * 60);
        return await redisClient.lrange(`crawl:${crawlId}:jobs_done_ordered`, start, end);
    }
    catch (error) {
        logger_1.logger.error('Error getting completed crawl jobs', { error, crawlId });
        throw error;
    }
}
async function getCrawlDoneJobsCount(crawlId) {
    try {
        // First try the new format
        const successJobsCount = await redisClient.scard(`crawl:${crawlId}:jobs:done:success`);
        if (successJobsCount > 0) {
            return successJobsCount;
        }
        // Fallback to old format
        return await redisClient.llen(`crawl:${crawlId}:jobs_done_ordered`);
    }
    catch (error) {
        logger_1.logger.error('Error getting completed crawl jobs count', { error, crawlId });
        throw error;
    }
}
async function markCrawlFinished(crawlId) {
    try {
        const isFinished = await isCrawlFinished(crawlId);
        if (isFinished) {
            const result = await redisClient.setnx(`crawl:${crawlId}:finish`, 'yes');
            await redisClient.expire(`crawl:${crawlId}:finish`, 24 * 60 * 60);
            // Set completion timestamp
            if (result === 1) {
                await redisClient.set(`crawl:${crawlId}:completed_at`, Date.now());
                await redisClient.expire(`crawl:${crawlId}:completed_at`, 24 * 60 * 60);
                logger_1.logger.info(`Crawl ${crawlId} marked as finished`, { crawlId });
                // Trigger summary generation asynchronously (don't block completion)
                setImmediate(async () => {
                    try {
                        await generateCrawlSummary(crawlId);
                    }
                    catch (summaryError) {
                        logger_1.logger.error(`Failed to generate crawl summary for ${crawlId}`, { error: summaryError });
                    }
                });
            }
            return result === 1;
        }
        return false;
    }
    catch (error) {
        logger_1.logger.error('Error marking crawl as finished', { error, crawlId });
        throw error;
    }
}
async function isCrawlFinished(crawlId) {
    try {
        const jobCount = await redisClient.scard(`crawl:${crawlId}:jobs`);
        // Try both the new and old format for done jobs
        const newDoneJobCount = await redisClient.scard(`crawl:${crawlId}:jobs:done:success`);
        const oldDoneJobCount = await redisClient.scard(`crawl:${crawlId}:jobs_done`);
        const doneJobCount = Math.max(newDoneJobCount, oldDoneJobCount);
        logger_1.logger.debug(`Crawl ${crawlId}: ${doneJobCount}/${jobCount} jobs done`);
        return jobCount === doneJobCount && jobCount > 0;
    }
    catch (error) {
        logger_1.logger.error('Error checking if crawl is finished', { error, crawlId });
        throw error;
    }
}
async function cancelCrawl(crawlId) {
    try {
        const crawl = await getCrawl(crawlId);
        if (!crawl)
            throw new Error('Crawl not found');
        crawl.cancelled = true;
        await saveCrawl(crawlId, crawl);
    }
    catch (error) {
        logger_1.logger.error('Error canceling crawl', { error, crawlId });
        throw error;
    }
}
// Track exported files for crawls
async function addExportedFile(crawlId, filePath) {
    try {
        await redisClient.lpush(`crawl:${crawlId}:exported_files`, filePath);
        await redisClient.expire(`crawl:${crawlId}:exported_files`, 24 * 60 * 60);
    }
    catch (error) {
        logger_1.logger.error('Error tracking exported file', { error, crawlId, filePath });
    }
}
async function getExportedFiles(crawlId) {
    try {
        return await redisClient.lrange(`crawl:${crawlId}:exported_files`, 0, -1);
    }
    catch (error) {
        logger_1.logger.error('Error getting exported files', { error, crawlId });
        return [];
    }
}
// Generate crawl summary when crawl completes
async function generateCrawlSummary(crawlId) {
    try {
        // Import here to avoid circular dependency
        const { fileExportService } = await Promise.resolve().then(() => __importStar(require('./file-export.service')));
        const crawl = await getCrawl(crawlId);
        if (!crawl) {
            logger_1.logger.warn(`Cannot generate summary: crawl ${crawlId} not found`);
            return;
        }
        // Get crawl statistics
        const totalJobs = await redisClient.scard(`crawl:${crawlId}:jobs`);
        const successfulJobs = await redisClient.scard(`crawl:${crawlId}:jobs:done:success`);
        const failedJobs = await redisClient.scard(`crawl:${crawlId}:jobs:done:failed`);
        const exportedFiles = await getExportedFiles(crawlId);
        const completedAt = await redisClient.get(`crawl:${crawlId}:completed_at`);
        const summary = {
            initialUrl: crawl.originUrl,
            totalPages: totalJobs,
            successfulPages: successfulJobs,
            failedPages: failedJobs,
            startTime: new Date(crawl.createdAt).toISOString(),
            endTime: completedAt ? new Date(parseInt(completedAt)).toISOString() : new Date().toISOString(),
            exportedFiles: [...exportedFiles].reverse(), // Reverse to get chronological order
            crawlOptions: crawl.crawlerOptions
        };
        await fileExportService.exportCrawlSummary(crawlId, summary);
        // Also create consolidated export files for easy access
        try {
            const consolidatedMarkdown = await fileExportService.exportCrawlAsConsolidatedFile(crawlId, 'markdown');
            const consolidatedJson = await fileExportService.exportCrawlAsConsolidatedFile(crawlId, 'json');
            logger_1.logger.info(`Generated crawl summary and consolidated exports for ${crawlId}`, {
                crawlId,
                totalPages: summary.totalPages,
                successfulPages: summary.successfulPages,
                exportedFiles: summary.exportedFiles.length,
                consolidatedFiles: [consolidatedMarkdown, consolidatedJson]
            });
        }
        catch (consolidationError) {
            logger_1.logger.warn(`Failed to create consolidated exports for ${crawlId}`, { error: consolidationError });
            logger_1.logger.info(`Generated crawl summary for ${crawlId}`, {
                crawlId,
                totalPages: summary.totalPages,
                successfulPages: summary.successfulPages,
                exportedFiles: summary.exportedFiles.length
            });
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to generate crawl summary for ${crawlId}`, { error, crawlId });
    }
}
