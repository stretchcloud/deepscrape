import { v4 as uuidv4 } from 'uuid';
import { redisClient } from './redis.service';
import { logger } from '../utils/logger';
import scraperManager, { ScraperManager } from '../scraper/scraper-manager';
import { 
  BatchScrapeRequest, 
  BatchScrapeJob, 
  BatchScrapeStatusResponse,
  ScraperOptions,
  ScraperResponse 
} from '../types';
import axios from 'axios';

/**
 * Service for handling batch scraping operations
 */
export class BatchScrapeService {
  private static readonly BATCH_KEY_PREFIX = 'batch:';
  private static readonly BATCH_JOBS_KEY_PREFIX = 'batch:jobs:';
  private static readonly DEFAULT_CONCURRENCY = 3;
  private static readonly DEFAULT_TIMEOUT = 300000; // 5 minutes
  private static readonly MAX_CONCURRENCY = 10;
  private static readonly MAX_URLS = 100;

  /**
   * Initiate a new batch scraping operation
   */
  async initiateBatch(request: BatchScrapeRequest): Promise<{
    batchId: string;
    totalUrls: number;
    estimatedTime: number;
  }> {
    // Validate request
    this.validateBatchRequest(request);

    const batchId = uuidv4();
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
    await redisClient.set(
      `${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`,
      JSON.stringify(batchMetadata),
      'EX',
      86400 // 24 hours TTL
    );

    // Create individual jobs
    const jobs: BatchScrapeJob[] = request.urls.map((url, index) => ({
      id: `${batchId}_${index}`,
      url,
      status: 'pending',
      retryCount: 0
    }));

    // Store jobs in Redis
    await redisClient.set(
      `${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`,
      JSON.stringify(jobs),
      'EX',
      86400 // 24 hours TTL
    );

    // Start processing asynchronously
    setImmediate(() => {
      this.processBatch(batchId, request.options ?? {}, concurrency, timeout)
        .catch(error => {
          logger.error(`Batch processing failed for ${batchId}`, { error: (error as Error).message });
        });
    });

    logger.info(`Initiated batch scraping for ${request.urls.length} URLs`, {
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
  async getBatchStatus(batchId: string): Promise<BatchScrapeStatusResponse> {
    // Get batch metadata
    const metadataStr = await redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
    if (!metadataStr) {
      throw new Error(`Batch ${batchId} not found`);
    }

    const metadata = JSON.parse(metadataStr);

    // Get jobs
    const jobsStr = await redisClient.get(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
    const jobs: BatchScrapeJob[] = jobsStr ? JSON.parse(jobsStr) : [];

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
      await redisClient.set(
        `${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`,
        JSON.stringify(metadata),
        'EX',
        86400
      );

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
            logger.error(`Failed to send webhook for batch ${batchId}`, { error: (error as Error).message });
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
      results: completedJobs.slice(0, 20).map(job => job.result!), // Return first 20 results
      startTime: metadata.startTime,
      endTime: metadata.endTime,
      processingTime: metadata.endTime ? metadata.endTime - metadata.startTime : undefined,
      progress
    };
  }

  /**
   * Cancel a batch operation
   */
  async cancelBatch(batchId: string): Promise<void> {
    const metadataStr = await redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
    if (!metadataStr) {
      throw new Error(`Batch ${batchId} not found`);
    }

    const metadata = JSON.parse(metadataStr);
    metadata.status = 'cancelled';
    metadata.endTime = Date.now();

    await redisClient.set(
      `${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`,
      JSON.stringify(metadata),
      'EX',
      86400
    );

    logger.info(`Cancelled batch ${batchId}`);
  }

  /**
   * Process batch with controlled concurrency
   */
  private async processBatch(
    batchId: string,
    options: ScraperOptions,
    concurrency: number,
    timeout: number
  ): Promise<void> {
    try {
      // Update status to processing
      const metadataStr = await redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
      if (!metadataStr) return;

      const metadata = JSON.parse(metadataStr);
      metadata.status = 'processing';
      await redisClient.set(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`, JSON.stringify(metadata), 'EX', 86400);

      // Get jobs
      const jobsStr = await redisClient.get(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
      if (!jobsStr) return;

      const jobs: BatchScrapeJob[] = JSON.parse(jobsStr);
      // Use the singleton instance

      // Process jobs with controlled concurrency
      const processingPromises: Promise<void>[] = [];
      let activeJobs = 0;
      let jobIndex = 0;

      const processNextJob = async (): Promise<void> => {
        if (jobIndex >= jobs.length) return;

        const job = jobs[jobIndex++];
        activeJobs++;

        try {
          await this.processJob(job, scraperManager, options, metadata.maxRetries);
        } catch (error) {
          logger.error(`Error processing job ${job.id}`, { error: (error as Error).message });
        } finally {
          activeJobs--;
          
          // Save updated jobs
          await redisClient.set(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`, JSON.stringify(jobs), 'EX', 86400);
          
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

      logger.info(`Completed batch processing for ${batchId}`);

    } catch (error) {
      logger.error(`Batch processing failed for ${batchId}`, { error: (error as Error).message });
      
      // Update status to failed
      const metadataStr = await redisClient.get(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`);
      if (metadataStr) {
        const metadata = JSON.parse(metadataStr);
        metadata.status = 'failed';
        metadata.endTime = Date.now();
        metadata.error = (error as Error).message;
        await redisClient.set(`${BatchScrapeService.BATCH_KEY_PREFIX}${batchId}`, JSON.stringify(metadata), 'EX', 86400);
      }
    }
  }

  /**
   * Process individual job with retries
   */
  private async processJob(
    job: BatchScrapeJob,
    scraperManager: ScraperManager,
    options: ScraperOptions,
    maxRetries: number
  ): Promise<void> {
    job.startTime = Date.now();
    job.status = 'processing';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Processing job ${job.id} (attempt ${attempt + 1}/${maxRetries + 1})`);

        const result: ScraperResponse = await scraperManager.scrape(job.url, {
          ...options,
          timeout: 30000 // 30 second timeout per URL
        });

        job.result = result;
        job.status = 'completed';
        job.endTime = Date.now();
        job.processingTime = job.endTime - (job.startTime ?? job.endTime);
        job.retryCount = attempt;

        logger.debug(`Successfully processed job ${job.id}`);
        return;

      } catch (error) {
        job.retryCount = attempt;
        
        if (attempt < maxRetries) {
          logger.warn(`Job ${job.id} failed, retrying (${attempt + 1}/${maxRetries})`, {
            error: (error as Error).message
          });
          
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        } else {
          job.status = 'failed';
          job.error = (error as Error).message;
          job.endTime = Date.now();
          job.processingTime = job.endTime - (job.startTime ?? job.endTime);
          
          logger.error(`Job ${job.id} failed after ${maxRetries + 1} attempts`, {
            error: (error as Error).message
          });
        }
      }
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(webhookUrl: string, data: any): Promise<void> {
    try {
      await axios.post(webhookUrl, {
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

      logger.info(`Webhook sent successfully`, { webhookUrl });
    } catch (error) {
      logger.error(`Failed to send webhook`, { 
        webhookUrl, 
        error: (error as Error).message 
      });
    }
  }

  /**
   * Validate batch request
   */
  private validateBatchRequest(request: BatchScrapeRequest): void {
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
      } catch {
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
  async getJobResult(batchId: string, jobId: string): Promise<ScraperResponse | null> {
    try {
      const jobsStr = await redisClient.get(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
      if (!jobsStr) {
        throw new Error(`Batch ${batchId} not found`);
      }

      const jobs: BatchScrapeJob[] = JSON.parse(jobsStr);
      const job = jobs.find(j => j.id === jobId);
      
      if (!job || job.status !== 'completed' || !job.result) {
        return null;
      }

      return job.result;
    } catch (error) {
      logger.error('Failed to get job result', {
        batchId,
        jobId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Clean up old batch data
   */
  async cleanup(olderThanDays: number = 7): Promise<void> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    try {
      const keys = await redisClient.keys(`${BatchScrapeService.BATCH_KEY_PREFIX}*`);
      
      for (const key of keys) {
        const metadataStr = await redisClient.get(key);
        if (metadataStr) {
          const metadata = JSON.parse(metadataStr);
          if (metadata.startTime < cutoffTime) {
            const batchId = key.replace(BatchScrapeService.BATCH_KEY_PREFIX, '');
            await redisClient.del(key);
            await redisClient.del(`${BatchScrapeService.BATCH_JOBS_KEY_PREFIX}${batchId}`);
            logger.info(`Cleaned up old batch ${batchId}`);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup old batches', { error: (error as Error).message });
    }
  }
}

// Export singleton instance
export const batchScrapeService = new BatchScrapeService();