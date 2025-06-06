"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlQueue = void 0;
exports.initQueue = initQueue;
exports.addCrawlJobToQueue = addCrawlJobToQueue;
exports.addCrawlJobsToQueue = addCrawlJobsToQueue;
exports.initializeWorker = initializeWorker;
exports.getJob = getJob;
exports.getJobs = getJobs;
const bullmq_1 = require("bullmq");
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
const redis_service_1 = require("./redis.service");
const crawler_processor_1 = require("../scraper/crawler-processor");
const ioredis_1 = __importDefault(require("ioredis"));
const QUEUE_NAME = 'deepscrape-crawler-queue';
const redisConnection = new ioredis_1.default({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
});
// Create Bull queue
const crawlQueue = new bullmq_1.Queue(QUEUE_NAME, {
    connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379')
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: false,
        removeOnFail: false,
    },
});
exports.crawlQueue = crawlQueue;
// Initialize the queue
async function initQueue() {
    logger_1.logger.info('Initializing crawler queue');
    // Ensure the queue is empty when starting
    await crawlQueue.obliterate({ force: true });
    logger_1.logger.info('Queue initialized');
}
// Add a crawl job to the queue
async function addCrawlJobToQueue(crawlId, jobData, priority = 10) {
    const jobId = (0, uuid_1.v4)();
    logger_1.logger.debug('Adding job to queue', { crawlId, jobId });
    // First add to Redis for tracking
    await (0, redis_service_1.addCrawlJob)(crawlId, jobId);
    // Then add to BullMQ
    await crawlQueue.add(jobId, {
        ...jobData,
        crawlId,
        jobId
    }, {
        priority,
        jobId,
    });
    return jobId;
}
// Add multiple crawl jobs at once
async function addCrawlJobsToQueue(crawlId, jobsData, priority = 10) {
    if (jobsData.length === 0)
        return [];
    const jobIds = jobsData.map(() => (0, uuid_1.v4)());
    // Add all jobs to BullMQ in bulk
    await crawlQueue.addBulk(jobsData.map((data, index) => ({
        name: jobIds[index],
        data: { ...data, crawlId, jobId: jobIds[index] },
        opts: { priority, jobId: jobIds[index] }
    })));
    return jobIds;
}
// Initialize the worker
function initializeWorker() {
    const worker = new bullmq_1.Worker(QUEUE_NAME, async (job) => {
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
    }, {
        connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379')
        },
        concurrency: 5, // Process 5 jobs at a time
    });
    worker.on('completed', (job) => {
        logger_1.logger.debug('Job completed', { jobId: job.id });
        // Store the full job result in Redis
        if (job.data.crawlId && job.returnvalue) {
            (0, redis_service_1.markCrawlJobDone)(job.data.crawlId, job.id, true, job.returnvalue)
                .catch(err => logger_1.logger.error(`Error storing job result in Redis: ${err.message}`, { jobId: job.id }));
        }
    });
    worker.on('failed', (job, error) => {
        logger_1.logger.error('Job failed', { jobId: job?.id, error });
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
