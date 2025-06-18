"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.batchScrapeService = exports.BatchScrapeService = void 0;
const uuid_1 = require("uuid");
const redis_service_1 = require("./redis.service");
const logger_1 = require("../utils/logger");
const scraper_manager_1 = __importDefault(require("../scraper/scraper-manager"));
const axios_1 = __importDefault(require("axios"));
/**
 * Service for handling batch scraping operations
 */
class BatchScrapeService {
    /**
     * Initiate a new batch scraping operation
     */
    async initiateBatch(request) {
        // Validate request
        this.validateBatchRequest(request);
        const batchId = (0, uuid_1.v4)();
        const concurrency = Math.min(request.concurrency ?? BatchScrapeService.DEFAULT_CONCURRENCY, BatchScrapeService.MAX_CONCURRENCY);
        const timeout = request.timeout ?? BatchScrapeService.DEFAULT_TIMEOUT;
        // Estimate processing time based on URL count and concurrency
        const estimatedTime = Math.ceil((request.urls.length / concurrency) * 30000); // ~30s per URL
        // Create batch metadata
        const batchMetadata = {
            batchId,
            status: 'pending',
            totalUrls: request.urls.length,
            completedUrls: 0,
            failedUrls: 0,
            pendingUrls: request.urls.length,
            startTime: Date.now(),
            concurrency,
            timeout,
            webhook: request.webhook,
            failFast: request.failFast ?? false,
            maxRetries: request.maxRetries ?? 3,
            options: request.options ?? {}
        };
        // Store batch metadata in Redis
        await redis_service_1.redisClient.set(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`, JSON.stringify(batchMetadata), 'EX', 86400 // 24 hours TTL
        );
        // Create individual jobs
        const jobs = request.urls.map((url, index) => ({
            id: `${batchId}_${index}`,
            url,
            status: 'pending',
            retryCount: 0
        }));
        // Store jobs in Redis
        await redis_service_1.redisClient.set(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`, JSON.stringify(jobs), 'EX', 86400 // 24 hours TTL
        );
        // Start processing asynchronously
        setImmediate(() => {
            this.processBatch(batchId, request.options ?? {}, concurrency, timeout)
                .catch(error => {
                logger_1.logger.error(`Batch processing failed for ${batchId}`, { error: error.message });
            });
        });
        logger_1.logger.info(`Initiated batch scraping for ${request.urls.length} URLs`, {
            batchId,
            concurrency,
            estimatedTime
        });
        return {
            batchId,
            totalUrls: request.urls.length,
            estimatedTime
        };
    }
    /**
     * Get batch status and results
     */
    async getBatchStatus(batchId) {
        // Get batch metadata
        const metadataStr = await redis_service_1.redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
        if (!metadataStr) {
            throw new Error(`Batch ${batchId} not found`);
        }
        const metadata = JSON.parse(metadataStr);
        // Get jobs
        const jobsStr = await redis_service_1.redisClient.get(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
        const jobs = jobsStr ? JSON.parse(jobsStr) : [];
        // Calculate statistics
        const completedJobs = jobs.filter(job => job.status === 'completed');
        const failedJobs = jobs.filter(job => job.status === 'failed');
        const pendingJobs = jobs.filter(job => job.status === 'pending' || job.status === 'processing');
        const progress = metadata.totalUrls > 0
            ? Math.round(((completedJobs.length + failedJobs.length) / metadata.totalUrls) * 100)
            : 0;
        // Determine overall status
        let status = metadata.status;
        if (status === 'processing' && pendingJobs.length === 0) {
            status = failedJobs.length === 0 ? 'completed' : 'completed_with_errors';
            // Update metadata status
            metadata.status = status;
            metadata.endTime = Date.now();
            await redis_service_1.redisClient.set(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`, JSON.stringify(metadata), 'EX', 86400);
            // Send webhook if configured
            if (metadata.webhook) {
                setImmediate(() => {
                    this.sendWebhook(metadata.webhook, {
                        batchId,
                        status,
                        totalUrls: metadata.totalUrls,
                        completedUrls: completedJobs.length,
                        failedUrls: failedJobs.length,
                        endTime: metadata.endTime
                    }).catch(error => {
                        logger_1.logger.error(`Failed to send webhook for batch ${batchId}`, { error: error.message });
                    });
                });
            }
        }
        return {
            success: true,
            batchId,
            status,
            totalUrls: metadata.totalUrls,
            completedUrls: completedJobs.length,
            failedUrls: failedJobs.length,
            pendingUrls: pendingJobs.length,
            jobs: jobs.slice(0, 50), // Limit response size
            results: completedJobs.slice(0, 20).map(job => job.result), // Return first 20 results
            startTime: metadata.startTime,
            endTime: metadata.endTime,
            processingTime: metadata.endTime ? metadata.endTime - metadata.startTime : undefined,
            progress
        };
    }
    /**
     * Cancel a batch operation
     */
    async cancelBatch(batchId) {
        const metadataStr = await redis_service_1.redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
        if (!metadataStr) {
            throw new Error(`Batch ${batchId} not found`);
        }
        const metadata = JSON.parse(metadataStr);
        metadata.status = 'cancelled';
        metadata.endTime = Date.now();
        await redis_service_1.redisClient.set(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`, JSON.stringify(metadata), 'EX', 86400);
        logger_1.logger.info(`Cancelled batch ${batchId}`);
    }
    /**
     * Process batch with controlled concurrency
     */
    async processBatch(batchId, options, concurrency, timeout) {
        try {
            // Update status to processing
            const metadataStr = await redis_service_1.redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
            if (!metadataStr)
                return;
            const metadata = JSON.parse(metadataStr);
            metadata.status = 'processing';
            await redis_service_1.redisClient.set(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`, JSON.stringify(metadata), 'EX', 86400);
            // Get jobs
            const jobsStr = await redis_service_1.redisClient.get(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
            if (!jobsStr)
                return;
            const jobs = JSON.parse(jobsStr);
            // Use the singleton instance
            // Process jobs with controlled concurrency
            const processingPromises = [];
            let activeJobs = 0;
            let jobIndex = 0;
            const processNextJob = async () => {
                if (jobIndex >= jobs.length)
                    return;
                const job = jobs[jobIndex++];
                activeJobs++;
                try {
                    await this.processJob(job, scraper_manager_1.default, options, metadata.maxRetries);
                }
                catch (error) {
                    logger_1.logger.error(`Error processing job ${job.id}`, { error: error.message });
                }
                finally {
                    activeJobs--;
                    // Save updated jobs
                    await redis_service_1.redisClient.set(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`, JSON.stringify(jobs), 'EX', 86400);
                    // Process next job if available
                    if (jobIndex < jobs.length && activeJobs < concurrency) {
                        processingPromises.push(processNextJob());
                    }
                }
            };
            // Start initial batch of jobs
            for (let i = 0; i < Math.min(concurrency, jobs.length); i++) {
                processingPromises.push(processNextJob());
            }
            // Wait for all jobs to complete or timeout
            await Promise.race([
                Promise.all(processingPromises),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Batch timeout')), timeout))
            ]);
            logger_1.logger.info(`Completed batch processing for ${batchId}`);
        }
        catch (error) {
            logger_1.logger.error(`Batch processing failed for ${batchId}`, { error: error.message });
            // Update status to failed
            const metadataStr = await redis_service_1.redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
            if (metadataStr) {
                const metadata = JSON.parse(metadataStr);
                metadata.status = 'failed';
                metadata.endTime = Date.now();
                metadata.error = error.message;
                await redis_service_1.redisClient.set(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`, JSON.stringify(metadata), 'EX', 86400);
            }
        }
    }
    /**
     * Process individual job with retries
     */
    async processJob(job, scraperManager, options, maxRetries) {
        job.startTime = Date.now();
        job.status = 'processing';
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                logger_1.logger.debug(`Processing job ${job.id} (attempt ${attempt + 1}/${maxRetries + 1})`);
                const result = await scraperManager.scrape(job.url, {
                    ...options,
                    timeout: 30000 // 30 second timeout per URL
                });
                job.result = result;
                job.status = 'completed';
                job.endTime = Date.now();
                job.processingTime = job.endTime - (job.startTime ?? job.endTime);
                job.retryCount = attempt;
                logger_1.logger.debug(`Successfully processed job ${job.id}`);
                return;
            }
            catch (error) {
                job.retryCount = attempt;
                if (attempt < maxRetries) {
                    logger_1.logger.warn(`Job ${job.id} failed, retrying (${attempt + 1}/${maxRetries})`, {
                        error: error.message
                    });
                    // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
                else {
                    job.status = 'failed';
                    job.error = error.message;
                    job.endTime = Date.now();
                    job.processingTime = job.endTime - (job.startTime ?? job.endTime);
                    logger_1.logger.error(`Job ${job.id} failed after ${maxRetries + 1} attempts`, {
                        error: error.message
                    });
                }
            }
        }
    }
    /**
     * Send webhook notification
     */
    async sendWebhook(webhookUrl, data) {
        try {
            await axios_1.default.post(webhookUrl, {
                event: 'batch_scrape.completed',
                data,
                timestamp: new Date().toISOString()
            }, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'DeepScrape-Webhook/1.0'
                }
            });
            logger_1.logger.info(`Webhook sent successfully`, { webhookUrl });
        }
        catch (error) {
            logger_1.logger.error(`Failed to send webhook`, {
                webhookUrl,
                error: error.message
            });
        }
    }
    /**
     * Validate batch request
     */
    validateBatchRequest(request) {
        if (!request.urls || !Array.isArray(request.urls) || request.urls.length === 0) {
            throw new Error('URLs array is required and must not be empty');
        }
        if (request.urls.length > BatchScrapeService.MAX_URLS) {
            throw new Error(`Maximum ${BatchScrapeService.MAX_URLS} URLs allowed per batch`);
        }
        // Validate URLs
        for (const url of request.urls) {
            if (!url || typeof url !== 'string') {
                throw new Error('All URLs must be valid strings');
            }
            try {
                new URL(url);
            }
            catch {
                throw new Error(`Invalid URL: ${url}`);
            }
        }
        if (request.concurrency && (request.concurrency < 1 || request.concurrency > BatchScrapeService.MAX_CONCURRENCY)) {
            throw new Error(`Concurrency must be between 1 and ${BatchScrapeService.MAX_CONCURRENCY}`);
        }
        if (request.timeout && request.timeout < 10000) {
            throw new Error('Timeout must be at least 10 seconds');
        }
    }
    /**
     * Get individual job result
     */
    async getJobResult(batchId, jobId) {
        try {
            const jobsStr = await redis_service_1.redisClient.get(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
            if (!jobsStr) {
                throw new Error(`Batch ${batchId} not found`);
            }
            const jobs = JSON.parse(jobsStr);
            const job = jobs.find(j => j.id === jobId);
            if (!job || job.status !== 'completed' || !job.result) {
                return null;
            }
            return job.result;
        }
        catch (error) {
            logger_1.logger.error('Failed to get job result', {
                batchId,
                jobId,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Clean up old batch data
     */
    async cleanup(olderThanDays = 7) {
        const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        try {
            const keys = await redis_service_1.redisClient.keys(`${BatchScrapeService.BATCH_KEY_PREFIX}*`);
            for (const key of keys) {
                const metadataStr = await redis_service_1.redisClient.get(key);
                if (metadataStr) {
                    const metadata = JSON.parse(metadataStr);
                    if (metadata.startTime < cutoffTime) {
                        const batchId = key.replace(BatchScrapeService.BATCH_KEY_PREFIX, '');
                        await redis_service_1.redisClient.del(key);
                        await redis_service_1.redisClient.del(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
                        logger_1.logger.info(`Cleaned up old batch ${batchId}`);
                    }
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to cleanup old batches', { error: error.message });
        }
    }
}
exports.BatchScrapeService = BatchScrapeService;
BatchScrapeService.BATCH_KEY_PREFIX = 'batch:';
BatchScrapeService.BATCH_JOBS_KEY_PREFIX = 'batch:jobs:';
BatchScrapeService.DEFAULT_CONCURRENCY = 3;
BatchScrapeService.DEFAULT_TIMEOUT = 300000; // 5 minutes
BatchScrapeService.MAX_CONCURRENCY = 10;
BatchScrapeService.MAX_URLS = 100;
// Export singleton instance
exports.batchScrapeService = new BatchScrapeService();
