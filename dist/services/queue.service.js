"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlQueue = exports.enhancedQueue = void 0;
exports.initQueue = initQueue;
exports.addCrawlJobToQueue = addCrawlJobToQueue;
exports.addCrawlJobsToQueue = addCrawlJobsToQueue;
exports.initializeWorker = initializeWorker;
exports.getJob = getJob;
exports.getJobs = getJobs;
exports.getQueueStats = getQueueStats;
exports.closeQueue = closeQueue;
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
const redis_service_1 = require("./redis.service");
const crawler_processor_1 = require("../scraper/crawler-processor");
const enhanced_queue_service_1 = require("./enhanced-queue.service");
const QUEUE_NAME = 'deepscrape-crawler-queue';
// Initialize enhanced queue service with crawler-specific configuration
const enhancedQueue = new enhanced_queue_service_1.EnhancedQueueService(QUEUE_NAME, {
    concurrency: parseInt(process.env.CRAWLER_CONCURRENCY || '5'),
    maxJobs: parseInt(process.env.CRAWLER_MAX_JOBS || '1000'),
    lockDuration: parseInt(process.env.CRAWLER_LOCK_DURATION || '300000'), // 5 minutes for crawler jobs
    lockRenewTime: parseInt(process.env.CRAWLER_LOCK_RENEW_TIME || '60000'), // 1 minute
    retryAttempts: parseInt(process.env.CRAWLER_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.CRAWLER_RETRY_DELAY || '5000'),
    enableDynamicScaling: process.env.CRAWLER_ENABLE_DYNAMIC_SCALING === 'true',
    maxConcurrency: parseInt(process.env.CRAWLER_MAX_CONCURRENCY || '20'),
    minConcurrency: parseInt(process.env.CRAWLER_MIN_CONCURRENCY || '1')
});
exports.enhancedQueue = enhancedQueue;
// Legacy compatibility - expose the underlying queue
const crawlQueue = enhancedQueue.bullQueue;
exports.crawlQueue = crawlQueue;
// Initialize the queue
async function initQueue() {
    logger_1.logger.info('Initializing enhanced crawler queue');
    // Inject the queue function to break circular dependency
    (0, crawler_processor_1.setAddJobsToQueueFn)(addCrawlJobsToQueue);
    // Ensure the queue is empty when starting - access through enhancedQueue
    await crawlQueue.obliterate({ force: true });
    logger_1.logger.info('Enhanced crawler queue initialized');
}
// Add a crawl job to the queue
async function addCrawlJobToQueue(crawlId, jobData, priority = 10) {
    const jobId = (0, uuid_1.v4)();
    logger_1.logger.debug('Adding job to enhanced queue', { crawlId, jobId });
    // First add to Redis for tracking
    await (0, redis_service_1.addCrawlJob)(crawlId, jobId);
    // Use enhanced queue service to add job
    await enhancedQueue.addJob(jobId, {
        ...jobData,
        crawlId,
        jobId
    }, {
        priority,
    });
    return jobId;
}
// Add multiple crawl jobs at once
async function addCrawlJobsToQueue(crawlId, jobsData, priority = 10) {
    if (jobsData.length === 0)
        return [];
    const jobIds = jobsData.map(() => (0, uuid_1.v4)());
    // Use enhanced queue service for bulk operations
    await enhancedQueue.addBulkJobs(jobsData.map((data, index) => ({
        name: jobIds[index],
        data: { ...data, crawlId, jobId: jobIds[index] },
        opts: { priority }
    })));
    return jobIds;
}
// Initialize the worker
function initializeWorker() {
    // Use enhanced queue service to initialize worker with advanced features
    const worker = enhancedQueue.initializeWorker(async (job) => {
        try {
            logger_1.logger.info(`Processing job ${job.id}`, { jobType: job.data.mode, url: job.data.url });
            // Process the job using the crawler processor
            const result = await (0, crawler_processor_1.processCrawlJob)(job);
            // Mark job as completed in Redis
            if (job.data.crawlId) {
                await (0, redis_service_1.markCrawlJobDone)(job.data.crawlId, job.id, true, result);
            }
            logger_1.logger.info(`Job ${job.id} completed successfully`);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`Job ${job.id} failed: ${error.message}`, { error });
            // Mark job as failed in Redis
            if (job.data.crawlId) {
                await (0, redis_service_1.markCrawlJobDone)(job.data.crawlId, job.id, false);
            }
            throw error;
        }
    });
    // Additional event handlers for crawler-specific logic
    worker.on('completed', (job) => {
        logger_1.logger.debug('Crawler job completed', { jobId: job.id });
        // Store the full job result in Redis
        if (job.data.crawlId && job.returnvalue) {
            (0, redis_service_1.markCrawlJobDone)(job.data.crawlId, job.id, true, job.returnvalue)
                .catch(err => logger_1.logger.error(`Error storing job result in Redis: ${err.message}`, { jobId: job.id }));
        }
    });
    worker.on('failed', (job, error) => {
        logger_1.logger.error('Crawler job failed', { jobId: job?.id, error });
    });
    logger_1.logger.info('Enhanced crawler worker initialized with advanced features', {
        concurrency: enhancedQueue.currentConfig.concurrency,
        dynamicScaling: enhancedQueue.currentConfig.enableDynamicScaling,
        lockDuration: enhancedQueue.currentConfig.lockDuration
    });
    return worker;
}
// Get a job by ID
async function getJob(jobId) {
    return await crawlQueue.getJob(jobId);
}
// Get jobs by IDs
async function getJobs(jobIds) {
    return await Promise.all(jobIds.map(id => crawlQueue.getJob(id))).then(jobs => jobs.filter(Boolean));
}
// Get enhanced queue statistics
async function getQueueStats() {
    return await enhancedQueue.getStats();
}
// Graceful shutdown
async function closeQueue() {
    await enhancedQueue.close();
}
