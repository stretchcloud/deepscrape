"use strict";
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
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
// Connect to Redis using the Docker configuration
const redisClient = new ioredis_1.default({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
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
        scrapeOptions: data.scrapeOptions || {},
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
            const paginatedJobs = start === 0 && end === -1
                ? successJobs
                : successJobs.slice(start, end === -1 ? undefined : end + 1);
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
