import { logger } from '../utils/logger';
import { createRedisClient } from './redis-connection';

// Unified connection: supports REDIS_URL (with rediss:// TLS) or host/port/password.
const redisClient = createRedisClient('main');

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
    keywords?: string[];
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
      keywords: data.keywords,
      useBrowser: data.useBrowser
    },
    scrapeOptions: data.scrapeOptions || {},
    createdAt: Date.now(),
    robots: data.robots
  };

  // Set the 24h TTL at write time (previously only applied on first getCrawl,
  // so a never-polled crawl record would leak forever).
  await redisClient.set(`crawl:${id}`, JSON.stringify(storedCrawl), 'EX', 24 * 60 * 60);
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
  result: any = null,
  errorInfo?: { url?: string; error?: string }
): Promise<void> {
  try {
    // Add to the appropriate terminal set. On success, also remove the job from
    // the failed set: a job that failed an earlier attempt and then succeeded on
    // retry must be counted once, as a success (previously it was double-counted).
    if (success) {
      await redisClient.sadd(`crawl:${crawlId}:jobs:done:success`, jobId);
      await redisClient.srem(`crawl:${crawlId}:jobs:done:failed`, jobId);
      await redisClient.hdel(`crawl:${crawlId}:errors`, jobId);
    } else {
      // Only mark failed if not already recorded as a success.
      const isSuccess = await redisClient.sismember(`crawl:${crawlId}:jobs:done:success`, jobId);
      if (!isSuccess) {
        await redisClient.sadd(`crawl:${crawlId}:jobs:done:failed`, jobId);
        // Record the failure reason for the /errors introspection endpoint.
        await redisClient.hset(
          `crawl:${crawlId}:errors`,
          jobId,
          JSON.stringify({ url: errorInfo?.url, error: errorInfo?.error ?? 'unknown error', at: new Date().toISOString() })
        );
        await redisClient.expire(`crawl:${crawlId}:errors`, 24 * 60 * 60);
      }
    }
    await redisClient.expire(`crawl:${crawlId}:jobs:done:success`, 24 * 60 * 60);
    await redisClient.expire(`crawl:${crawlId}:jobs:done:failed`, 24 * 60 * 60);

    // Store the per-job result separately (survives BullMQ removeOnComplete).
    if (result) {
      await redisClient.set(`crawl:${crawlId}:job:${jobId}:result`, JSON.stringify(result), 'EX', 86400);
    }

    // Completion is derived from set cardinality (success + failed === total),
    // gated on kickoff/discovery completion inside isCrawlFinished().
    await markCrawlFinished(crawlId);
  } catch (error) {
    logger.error('Error marking job as done in Redis', { error, crawlId, jobId });
    throw error;
  }
}

/** Per-page failure list for a crawl (jobId -> {url, error, at}). */
export async function getCrawlErrors(crawlId: string): Promise<Array<{ id: string; url?: string; error: string; at?: string }>> {
  try {
    const raw = await redisClient.hgetall(`crawl:${crawlId}:errors`);
    return Object.entries(raw).map(([id, val]) => {
      try {
        const parsed = JSON.parse(val);
        return { id, url: parsed.url, error: parsed.error ?? 'unknown error', at: parsed.at };
      } catch {
        return { id, error: val };
      }
    });
  } catch (error) {
    logger.error('Error getting crawl errors', { error, crawlId });
    return [];
  }
}

// --- Active crawl registry (for GET /api/crawl/active) ---

/** Register a crawl as active (sorted set scored by start time). */
export async function addActiveCrawl(crawlId: string, meta: { url: string; createdAt: number }): Promise<void> {
  try {
    await redisClient.zadd('active_crawls', meta.createdAt, crawlId);
    await redisClient.set(`crawl:${crawlId}:meta`, JSON.stringify(meta), 'EX', 24 * 60 * 60);
  } catch (error) {
    logger.error('Error registering active crawl', { error, crawlId });
  }
}

export async function removeActiveCrawl(crawlId: string): Promise<void> {
  try {
    await redisClient.zrem('active_crawls', crawlId);
  } catch (error) {
    logger.error('Error removing active crawl', { error, crawlId });
  }
}

/** List currently-active crawls with lightweight progress. */
export async function getActiveCrawls(): Promise<Array<{ id: string; url?: string; createdAt?: number; progress: any }>> {
  try {
    const ids = await redisClient.zrevrange('active_crawls', 0, 99);
    const out = [];
    for (const id of ids) {
      const metaRaw = await redisClient.get(`crawl:${id}:meta`);
      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      const progress = await getCrawlProgress(id);
      out.push({ id, url: meta.url, createdAt: meta.createdAt, progress });
    }
    return out;
  } catch (error) {
    logger.error('Error listing active crawls', { error });
    return [];
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

/** Aggregate progress counters for a crawl, derived purely from Redis sets. */
export async function getCrawlProgress(crawlId: string): Promise<{
  total: number; success: number; failed: number; done: number;
}> {
  const [total, success, failed] = await Promise.all([
    redisClient.scard(`crawl:${crawlId}:jobs`),
    redisClient.scard(`crawl:${crawlId}:jobs:done:success`),
    redisClient.scard(`crawl:${crawlId}:jobs:done:failed`)
  ]);
  return { total, success, failed, done: success + failed };
}

/** Read a stored per-job result document (survives BullMQ removeOnComplete). */
export async function getCrawlJobResult(crawlId: string, jobId: string): Promise<any | null> {
  const raw = await redisClient.get(`crawl:${crawlId}:job:${jobId}:result`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
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
        // No longer active.
        await removeActiveCrawl(crawlId);

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

    // Done = successes + failures. Counting failures is essential: otherwise a
    // single permanently-failed page wedges the crawl in "scraping" forever.
    const successCount = await redisClient.scard(`crawl:${crawlId}:jobs:done:success`);
    const failedCount = await redisClient.scard(`crawl:${crawlId}:jobs:done:failed`);
    const doneJobCount = successCount + failedCount;

    // Gate 1: link discovery / kickoff must have finished enqueuing jobs,
    // otherwise we could "complete" at page 1 while more jobs are still coming.
    const kickoffFinished = await redisClient.exists(`crawl:${crawlId}:kickoff:finish`);
    // Gate 2: streaming discovery (map mode) must not still be running.
    const streamingActive = await redisClient.exists(`crawl:${crawlId}:streaming:active`);

    logger.debug(`Crawl ${crawlId}: ${doneJobCount}/${jobCount} done (ok=${successCount} fail=${failedCount}), kickoff=${kickoffFinished} streaming=${streamingActive}`);

    if (!kickoffFinished || streamingActive) {
      return false;
    }

    return jobCount === doneJobCount && jobCount > 0;
  } catch (error) {
    logger.error('Error checking if crawl is finished', { error, crawlId });
    throw error;
  }
}

/** Mark that all kickoff/discovery jobs have finished being enqueued. */
export async function markCrawlKickoffFinished(crawlId: string): Promise<void> {
  await redisClient.set(`crawl:${crawlId}:kickoff:finish`, 'yes', 'EX', 24 * 60 * 60);
}

export async function isCrawlKickoffFinished(crawlId: string): Promise<boolean> {
  return (await redisClient.exists(`crawl:${crawlId}:kickoff:finish`)) === 1;
}

/**
 * Atomically claim a URL for a crawl. Returns true if this URL had not been seen
 * before (so the caller should enqueue it), false if already claimed. This is
 * the SADD-return-as-visited-check pattern — the atomic dedup that stops two
 * workers from crawling the same normalized URL.
 */
export async function lockCrawlUrl(crawlId: string, normalizedUrl: string): Promise<boolean> {
  const added = await redisClient.sadd(`crawl:${crawlId}:visited`, normalizedUrl);
  await redisClient.expire(`crawl:${crawlId}:visited`, 24 * 60 * 60);
  return added === 1;
}

/** Current number of pages that have been queued against the crawl budget. */
export async function getCrawlPageCount(crawlId: string): Promise<number> {
  const n = await redisClient.get(`crawl:${crawlId}:page_count`);
  return n ? parseInt(n, 10) : 0;
}

/**
 * Atomically reserve up to `want` slots against the crawl's page budget of
 * `limit`. Returns how many slots were actually granted (0..want). Uses INCRBY
 * then rolls back any overshoot so concurrent workers can't exceed the limit.
 */
export async function reserveCrawlPageSlots(crawlId: string, want: number, limit: number): Promise<number> {
  if (want <= 0) return 0;
  const key = `crawl:${crawlId}:page_count`;
  const total = await redisClient.incrby(key, want);
  await redisClient.expire(key, 24 * 60 * 60);
  if (total <= limit) return want;
  const overshoot = total - limit;
  const granted = Math.max(0, want - overshoot);
  // Roll back the portion we couldn't grant.
  await redisClient.decrby(key, want - granted);
  return granted;
}

export async function isCrawlCancelled(crawlId: string): Promise<boolean> {
  return (await redisClient.exists(`crawl:${crawlId}:cancelled`)) === 1;
}

// Streaming discovery status management
export async function markStreamingDiscoveryActive(crawlId: string): Promise<void> {
  try {
    await redisClient.set(`crawl:${crawlId}:streaming:active`, 'yes', 'EX', 3600); // 1 hour TTL
    logger.debug(`Marked streaming discovery as active for crawl ${crawlId}`);
  } catch (error) {
    logger.error('Error marking streaming discovery as active', { error, crawlId });
    throw error;
  }
}

export async function markStreamingDiscoveryComplete(crawlId: string): Promise<void> {
  try {
    await redisClient.del(`crawl:${crawlId}:streaming:active`);
    logger.info(`Marked streaming discovery as complete for crawl ${crawlId}`);
  } catch (error) {
    logger.error('Error marking streaming discovery as complete', { error, crawlId });
    throw error;
  }
}

export async function isStreamingDiscoveryActive(crawlId: string): Promise<boolean> {
  try {
    return await redisClient.exists(`crawl:${crawlId}:streaming:active`) === 1;
  } catch (error) {
    logger.error('Error checking streaming discovery status', { error, crawlId });
    throw error;
  }
}

export async function cancelCrawl(crawlId: string): Promise<void> {
  try {
    const crawl = await getCrawl(crawlId);
    if (!crawl) throw new Error('Crawl not found');

    // Store cancellation as its own key. The previous implementation round-tripped
    // the stored crawl back through saveCrawl (which expects the request shape),
    // corrupting the record and dropping the flag entirely.
    await redisClient.set(`crawl:${crawlId}:cancelled`, 'yes', 'EX', 24 * 60 * 60);

    // Stop streaming discovery and let completion logic finalize the crawl.
    await markStreamingDiscoveryComplete(crawlId);
    await markCrawlKickoffFinished(crawlId);
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
