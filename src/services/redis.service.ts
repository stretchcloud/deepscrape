import Redis from 'ioredis';
import { logger } from '../utils/logger';

// Connect to Redis using the Docker configuration
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error', { error: err });
});

redisClient.on('connect', () => {
  logger.info('Connected to Redis');
});

// Crawl data operations
export async function saveCrawl(
  id: string, 
  data: {
    url: string;
    includePaths?: string[];
    excludePaths?: string[];
    limit?: number;
    maxDepth?: number;
    allowBackwardCrawling?: boolean;
    allowExternalContentLinks?: boolean;
    allowSubdomains?: boolean;
    ignoreRobotsTxt?: boolean;
    regexOnFullURL?: boolean;
    strategy?: string;
    useBrowser?: boolean;
    scrapeOptions?: any;
    robots?: string;
  }
): Promise<void> {
  const storedCrawl: any = {
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

export async function getCrawl(id: string): Promise<any | null> {
  try {
    const data = await redisClient.get(`crawl:${id}`);
    if (!data) return null;
    
    // Refresh TTL
    await redisClient.expire(`crawl:${id}`, 24 * 60 * 60);
    
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error retrieving crawl data', { error, crawlId: id });
    throw error;
  }
}

export async function addCrawlJob(crawlId: string, jobId: string): Promise<void> {
  try {
    await redisClient.sadd(`crawl:${crawlId}:jobs`, jobId);
    await redisClient.expire(`crawl:${crawlId}:jobs`, 24 * 60 * 60);
  } catch (error) {
    logger.error('Error adding crawl job', { error, crawlId, jobId });
    throw error;
  }
}

export async function addCrawlJobs(crawlId: string, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  
  try {
    await redisClient.sadd(`crawl:${crawlId}:jobs`, ...jobIds);
    await redisClient.expire(`crawl:${crawlId}:jobs`, 24 * 60 * 60);
  } catch (error) {
    logger.error('Error adding crawl jobs', { error, crawlId, jobIds });
    throw error;
  }
}

export async function getCrawlJobs(crawlId: string): Promise<string[]> {
  try {
    return await redisClient.smembers(`crawl:${crawlId}:jobs`);
  } catch (error) {
    logger.error('Error getting crawl jobs', { error, crawlId });
    throw error;
  }
}

// Mark a job as done in Redis and store its result
export async function markCrawlJobDone(
  crawlId: string,
  jobId: string,
  success: boolean,
  result: any = null
): Promise<void> {
  try {
    // Add to appropriate set based on success/failure
    if (success) {
      await redisClient.sadd(`crawl:${crawlId}:jobs:done:success`, jobId);
    } else {
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
  } catch (error) {
    logger.error('Error marking job as done in Redis', { error, crawlId, jobId });
    throw error;
  }
}

export async function getCrawlDoneJobs(crawlId: string, start = 0, end = -1): Promise<string[]> {
  try {
    // First try the new format
    const successJobs = await redisClient.smembers(`crawl:${crawlId}:jobs:done:success`);
    
    // If we have success jobs, convert the set to an array and handle pagination
    if (successJobs.length > 0) {
      // Apply pagination manually since Redis sets don't support range slicing
      const paginatedJobs = start === 0 && end === -1 
        ? successJobs 
        : successJobs.slice(start, end === -1 ? undefined : end + 1);
      
      logger.debug(`Found ${successJobs.length} completed jobs for crawl ${crawlId}, returning ${paginatedJobs.length}`);
      return paginatedJobs;
    }
    
    // Fallback to old format
    logger.debug(`No jobs found in new format, trying old format for crawl ${crawlId}`);
    await redisClient.expire(`crawl:${crawlId}:jobs_done_ordered`, 24 * 60 * 60);
    return await redisClient.lrange(`crawl:${crawlId}:jobs_done_ordered`, start, end);
  } catch (error) {
    logger.error('Error getting completed crawl jobs', { error, crawlId });
    throw error;
  }
}

export async function getCrawlDoneJobsCount(crawlId: string): Promise<number> {
  try {
    // First try the new format
    const successJobsCount = await redisClient.scard(`crawl:${crawlId}:jobs:done:success`);
    
    if (successJobsCount > 0) {
      return successJobsCount;
    }
    
    // Fallback to old format
    return await redisClient.llen(`crawl:${crawlId}:jobs_done_ordered`);
  } catch (error) {
    logger.error('Error getting completed crawl jobs count', { error, crawlId });
    throw error;
  }
}

export async function markCrawlFinished(crawlId: string): Promise<boolean> {
  try {
    const isFinished = await isCrawlFinished(crawlId);
    if (isFinished) {
      const result = await redisClient.setnx(`crawl:${crawlId}:finish`, 'yes');
      await redisClient.expire(`crawl:${crawlId}:finish`, 24 * 60 * 60);
      
      // Set completion timestamp
      if (result === 1) {
        await redisClient.set(`crawl:${crawlId}:completed_at`, Date.now());
        await redisClient.expire(`crawl:${crawlId}:completed_at`, 24 * 60 * 60);
        
        logger.info(`Crawl ${crawlId} marked as finished`, { crawlId });
        
        // Trigger summary generation asynchronously (don't block completion)
        setImmediate(async () => {
          try {
            await generateCrawlSummary(crawlId);
          } catch (summaryError) {
            logger.error(`Failed to generate crawl summary for ${crawlId}`, { error: summaryError });
          }
        });
      }
      
      return result === 1;
    }
    return false;
  } catch (error) {
    logger.error('Error marking crawl as finished', { error, crawlId });
    throw error;
  }
}

export async function isCrawlFinished(crawlId: string): Promise<boolean> {
  try {
    const jobCount = await redisClient.scard(`crawl:${crawlId}:jobs`);
    
    // Try both the new and old format for done jobs
    const newDoneJobCount = await redisClient.scard(`crawl:${crawlId}:jobs:done:success`);
    const oldDoneJobCount = await redisClient.scard(`crawl:${crawlId}:jobs_done`);
    
    const doneJobCount = Math.max(newDoneJobCount, oldDoneJobCount);
    
    logger.debug(`Crawl ${crawlId}: ${doneJobCount}/${jobCount} jobs done`);
    
    return jobCount === doneJobCount && jobCount > 0;
  } catch (error) {
    logger.error('Error checking if crawl is finished', { error, crawlId });
    throw error;
  }
}

export async function cancelCrawl(crawlId: string): Promise<void> {
  try {
    const crawl = await getCrawl(crawlId);
    if (!crawl) throw new Error('Crawl not found');
    
    crawl.cancelled = true;
    await saveCrawl(crawlId, crawl);
  } catch (error) {
    logger.error('Error canceling crawl', { error, crawlId });
    throw error;
  }
}

// Track exported files for crawls
export async function addExportedFile(crawlId: string, filePath: string): Promise<void> {
  try {
    await redisClient.lpush(`crawl:${crawlId}:exported_files`, filePath);
    await redisClient.expire(`crawl:${crawlId}:exported_files`, 24 * 60 * 60);
  } catch (error) {
    logger.error('Error tracking exported file', { error, crawlId, filePath });
  }
}

export async function getExportedFiles(crawlId: string): Promise<string[]> {
  try {
    return await redisClient.lrange(`crawl:${crawlId}:exported_files`, 0, -1);
  } catch (error) {
    logger.error('Error getting exported files', { error, crawlId });
    return [];
  }
}

// Generate crawl summary when crawl completes
async function generateCrawlSummary(crawlId: string): Promise<void> {
  try {
    // Import here to avoid circular dependency
    const { fileExportService } = await import('./file-export.service');
    
    const crawl = await getCrawl(crawlId);
    if (!crawl) {
      logger.warn(`Cannot generate summary: crawl ${crawlId} not found`);
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
      exportedFiles: exportedFiles.reverse(), // Reverse to get chronological order
      crawlOptions: crawl.crawlerOptions
    };
    
    await fileExportService.exportCrawlSummary(crawlId, summary);
    
    // Also create consolidated export files for easy access
    try {
      const consolidatedMarkdown = await fileExportService.exportCrawlAsConsolidatedFile(crawlId, 'markdown');
      const consolidatedJson = await fileExportService.exportCrawlAsConsolidatedFile(crawlId, 'json');
      
      logger.info(`Generated crawl summary and consolidated exports for ${crawlId}`, {
        crawlId,
        totalPages: summary.totalPages,
        successfulPages: summary.successfulPages,
        exportedFiles: summary.exportedFiles.length,
        consolidatedFiles: [consolidatedMarkdown, consolidatedJson]
      });
    } catch (consolidationError) {
      logger.warn(`Failed to create consolidated exports for ${crawlId}`, { error: consolidationError });
      
      logger.info(`Generated crawl summary for ${crawlId}`, {
        crawlId,
        totalPages: summary.totalPages,
        successfulPages: summary.successfulPages,
        exportedFiles: summary.exportedFiles.length
      });
    }
  } catch (error) {
    logger.error(`Failed to generate crawl summary for ${crawlId}`, { error, crawlId });
  }
}

export { redisClient }; 