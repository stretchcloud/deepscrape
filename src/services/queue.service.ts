import { Job, Worker } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from './redis.service';
import { logger } from '../utils/logger';
import { markCrawlJobDone, addCrawlJob } from './redis.service';
import { processCrawlJob, setAddJobsToQueueFn } from '../scraper/crawler-processor';
import { EnhancedQueueService } from './enhanced-queue.service';

const QUEUE_NAME = 'deepscrape-crawler-queue';

// Initialize enhanced queue service with crawler-specific configuration
const enhancedQueue = new EnhancedQueueService(QUEUE_NAME, {
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

// Legacy compatibility - expose the underlying queue
const crawlQueue = enhancedQueue.bullQueue;

// Initialize the queue
export async function initQueue(): Promise<void> {
  logger.info('Initializing enhanced crawler queue');
  
  // Inject the queue function to break circular dependency
  setAddJobsToQueueFn(addCrawlJobsToQueue);
  
  // Ensure the queue is empty when starting - access through enhancedQueue
  await crawlQueue.obliterate({ force: true });
  logger.info('Enhanced crawler queue initialized');
}

// Add a crawl job to the queue
export async function addCrawlJobToQueue(
  crawlId: string,
  jobData: any,
  priority: number = 10
): Promise<string> {
  const jobId = uuidv4();
  
  logger.debug('Adding job to enhanced queue', { crawlId, jobId });
  
  // First add to Redis for tracking
  await addCrawlJob(crawlId, jobId);
  
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
export async function addCrawlJobsToQueue(
  crawlId: string,
  jobsData: any[],
  priority: number = 10
): Promise<string[]> {
  if (jobsData.length === 0) return [];
  
  const jobIds = jobsData.map(() => uuidv4());
  
  // Use enhanced queue service for bulk operations
  await enhancedQueue.addBulkJobs(
    jobsData.map((data, index) => ({
      name: jobIds[index],
      data: { ...data, crawlId, jobId: jobIds[index] },
      opts: { priority }
    }))
  );
  
  return jobIds;
}

// Initialize the worker
export function initializeWorker(): Worker {
  // Use enhanced queue service to initialize worker with advanced features
  const worker = enhancedQueue.initializeWorker(async (job: Job) => {
    try {
      logger.info(`Processing job ${job.id}`, { jobType: job.data.mode, url: job.data.url });
      
      // Process the job using the crawler processor
      const result = await processCrawlJob(job);
      
      // Mark job as completed in Redis
      if (job.data.crawlId) {
        await markCrawlJobDone(job.data.crawlId, job.id as string, true, result);
      }
      
      logger.info(`Job ${job.id} completed successfully`);
      return result;
    } catch (error: any) {
      logger.error(`Job ${job.id} failed: ${error.message}`, { error });
      
      // Mark job as failed in Redis
      if (job.data.crawlId) {
        await markCrawlJobDone(job.data.crawlId, job.id as string, false);
      }
      
      throw error;
    }
  });
  
  // Additional event handlers for crawler-specific logic
  worker.on('completed', (job) => {
    logger.debug('Crawler job completed', { jobId: job.id });
    
    // Store the full job result in Redis
    if (job.data.crawlId && job.returnvalue) {
      markCrawlJobDone(job.data.crawlId, job.id as string, true, job.returnvalue)
        .catch(err => logger.error(`Error storing job result in Redis: ${err.message}`, { jobId: job.id }));
    }
  });
  
  worker.on('failed', (job, error) => {
    logger.error('Crawler job failed', { jobId: job?.id, error });
  });
  
  logger.info('Enhanced crawler worker initialized with advanced features', {
    concurrency: enhancedQueue.currentConfig.concurrency,
    dynamicScaling: enhancedQueue.currentConfig.enableDynamicScaling,
    lockDuration: enhancedQueue.currentConfig.lockDuration
  });
  
  return worker;
}

// Get a job by ID
export async function getJob(jobId: string): Promise<Job | undefined> {
  return await crawlQueue.getJob(jobId);
}

// Get jobs by IDs
export async function getJobs(jobIds: string[]): Promise<Job[]> {
  return await Promise.all(
    jobIds.map(id => crawlQueue.getJob(id))
  ).then(jobs => jobs.filter(Boolean) as Job[]);
}

// Get enhanced queue statistics
export async function getQueueStats() {
  return await enhancedQueue.getStats();
}

// Graceful shutdown
export async function closeQueue(): Promise<void> {
  await enhancedQueue.close();
}

// Export enhanced queue service for advanced usage
export { enhancedQueue };

// Legacy compatibility export
export { crawlQueue }; 