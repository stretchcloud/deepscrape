import { Queue, Worker, Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from './redis.service';
import { logger } from '../utils/logger';
import { markCrawlJobDone, addCrawlJob } from './redis.service';
import { processCrawlJob } from '../scraper/crawler-processor';
import IORedis from 'ioredis';

const QUEUE_NAME = 'deepscrape-crawler-queue';

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
});

// Create Bull queue
const crawlQueue = new Queue(QUEUE_NAME, {
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

// Initialize the queue
export async function initQueue(): Promise<void> {
  logger.info('Initializing crawler queue');
  
  // Ensure the queue is empty when starting
  await crawlQueue.obliterate({ force: true });
  logger.info('Queue initialized');
}

// Add a crawl job to the queue
export async function addCrawlJobToQueue(
  crawlId: string,
  jobData: any,
  priority: number = 10
): Promise<string> {
  const jobId = uuidv4();
  
  logger.debug('Adding job to queue', { crawlId, jobId });
  
  // First add to Redis for tracking
  await addCrawlJob(crawlId, jobId);
  
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
export async function addCrawlJobsToQueue(
  crawlId: string,
  jobsData: any[],
  priority: number = 10
): Promise<string[]> {
  if (jobsData.length === 0) return [];
  
  const jobIds = jobsData.map(() => uuidv4());
  
  // Add all jobs to BullMQ in bulk
  await crawlQueue.addBulk(
    jobsData.map((data, index) => ({
      name: jobIds[index],
      data: { ...data, crawlId, jobId: jobIds[index] },
      opts: { priority, jobId: jobIds[index] }
    }))
  );
  
  return jobIds;
}

// Initialize the worker
export function initializeWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
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
    }, {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379')
      },
      concurrency: 5, // Process 5 jobs at a time
    }
  );
  
  worker.on('completed', (job) => {
    logger.debug('Job completed', { jobId: job.id });
    
    // Store the full job result in Redis
    if (job.data.crawlId && job.returnvalue) {
      markCrawlJobDone(job.data.crawlId, job.id as string, true, job.returnvalue)
        .catch(err => logger.error(`Error storing job result in Redis: ${err.message}`, { jobId: job.id }));
    }
  });
  
  worker.on('failed', (job, error) => {
    logger.error('Job failed', { jobId: job?.id, error });
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

export { crawlQueue }; 