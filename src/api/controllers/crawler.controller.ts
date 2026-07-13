import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { 
  CrawlRequest, 
  CrawlResponse, 
  CrawlStatusParams, 
  CrawlStatusQuery, 
  CrawlStatusResponse,
  CrawlCancelResponse
} from '../../types/crawler';
import { logger } from '../../utils/logger';
import { WebCrawler } from '../../scraper/crawler';
import { CrawlKickoffService } from '../../services/crawl-kickoff.service';
import {
  saveCrawl,
  getCrawl,
  getCrawlDoneJobs,
  cancelCrawl,
  isCrawlFinished,
  isCrawlCancelled,
  getCrawlProgress,
  getCrawlJobResult,
  getExportedFiles,
  getCrawlErrors,
  addActiveCrawl,
  getActiveCrawls
} from '../../services/redis.service';
import { addCrawlJobToQueue } from '../../services/queue.service';
import { fileExportService } from '../../services/file-export.service';
import archiver from 'archiver';

/** Derive a portable {url, title, markdown, metadata} view from a stored job result. */
function toPageRecord(result: any): { url: string; title: string; markdown: string; metadata: any } {
  const doc = result?.document ?? result ?? {};
  return {
    url: doc.url ?? result?.url ?? '',
    title: doc.title ?? result?.title ?? '',
    markdown: doc.content ?? result?.content ?? '',
    metadata: doc.metadata ?? result?.metadata ?? {}
  };
}

/** Build a filesystem-safe filename for a page. */
function safeFilename(url: string, index: number, ext: string): string {
  try {
    const u = new URL(url);
    const path = (u.pathname + u.search).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'index';
    return `${String(index).padStart(4, '0')}_${u.hostname.replace(/[^a-zA-Z0-9]+/g, '_')}_${path}.${ext}`.slice(0, 180);
  } catch {
    return `${String(index).padStart(4, '0')}_page.${ext}`;
  }
}

/**
 * Initiate a new crawl job
 */
export async function crawl(
  req: Request<{}, CrawlResponse, CrawlRequest>,
  res: Response<CrawlResponse>
): Promise<void> {
  try {
    const { 
      url, 
      includePaths, 
      excludePaths, 
      limit = 100,
      maxDepth = 5,
      allowBackwardCrawling = false,
      allowExternalContentLinks = false,
      allowSubdomains = false,
      ignoreRobotsTxt = false,
      regexOnFullURL = false,
      scrapeOptions = {},
      webhook,
      strategy,
      keywords,
      useBrowser = false,
      useMapDiscovery = false,
      // Map discovery specific parameters
      maxUrls,
      timeoutMs,
      skipSitemaps,
      sitemapsOnly,
      includePatterns,
      excludePatterns,
      crawlOptions = {}
    } = req.body;

    // Validate URL
    if (!url) {
      res.status(400).json({ success: false, error: 'URL is required' });
      return;
    }

    // Generate a unique ID for this crawl
    const id = uuidv4();
    
    logger.info(`Starting crawl ${id} for ${url}`, {
      crawlId: id,
      url,
      includePaths,
      excludePaths,
      limit,
      maxDepth,
      strategy,
      useBrowser
    });

    // Initialize WebCrawler
    const crawler = new WebCrawler({
      jobId: id,
      initialUrl: url,
      includes: includePaths,
      excludes: excludePaths,
      maxCrawledLinks: limit,
      limit,
      maxCrawledDepth: maxDepth,
      allowBackwardCrawling,
      allowExternalContentLinks,
      allowSubdomains,
      ignoreRobotsTxt,
      regexOnFullURL,
      strategy,
      useBrowser,
      deduplicateSimilarUrls: true // Enable URL deduplication by default
    });

    // Try to get robots.txt
    let robotsTxt = '';
    try {
      robotsTxt = await crawler.getRobotsTxt(scrapeOptions.skipTlsVerification ?? false);
      crawler.importRobotsTxt(robotsTxt);
    } catch (error) {
      logger.debug('Failed to get robots.txt (this is probably fine!)', { error });
    }

    // Persist the crawl record FIRST, before any jobs are enqueued, so that page
    // jobs (which read crawl options for recursion) always find it.
    await saveCrawl(id, {
      url,
      includePaths,
      excludePaths,
      limit,
      maxDepth,
      allowBackwardCrawling,
      allowExternalContentLinks,
      allowSubdomains,
      ignoreRobotsTxt,
      regexOnFullURL,
      strategy,
      keywords,
      useBrowser,
      scrapeOptions,
      robots: robotsTxt
    });

    // Register as an active crawl (for GET /api/crawl/active).
    await addActiveCrawl(id, { url, createdAt: Date.now() });

    // Decide the discovery strategy. Map discovery uses the streaming kickoff
    // service; if it fails we fall back to a traditional kickoff job so the
    // crawl never silently hangs with zero jobs.
    let useTraditionalKickoff = !useMapDiscovery;

    if (useMapDiscovery) {
      logger.info('Using Streaming Map Discovery for enhanced URL discovery', { url, limit, crawlId: id });
      try {
        const kickoffService = new CrawlKickoffService();
        const kickoffResult = await kickoffService.startStreamingCrawl({
          crawlId: id,
          url,
          limit: maxUrls || limit,
          maxDepth,
          allowSubdomains,
          includePaths: includePatterns || includePaths,
          excludePaths: excludePatterns || excludePaths,
          scrapeOptions: { ...scrapeOptions, useBrowser },
          useMapDiscovery: true,
          concurrency: crawlOptions.maxConcurrentCrawlers || 3,
          mapDiscoveryOptions: {
            timeoutMs: timeoutMs || 120000,
            skipSitemaps: skipSitemaps || false,
            sitemapsOnly: sitemapsOnly || false,
            crawlOptions
          }
        });

        if (kickoffResult.success) {
          logger.info('Streaming crawl kickoff successful', { crawlId: id, url, discoveryStarted: kickoffResult.discoveryStarted });
        } else {
          logger.warn('Streaming kickoff failed, falling back to traditional crawling', { crawlId: id, url, error: kickoffResult.message });
          useTraditionalKickoff = true;
        }
      } catch (error) {
        logger.warn('Streaming kickoff service threw, falling back to traditional crawling', { crawlId: id, url, error: (error as Error).message });
        useTraditionalKickoff = true;
      }
    }

    if (useTraditionalKickoff) {
      logger.info('Starting traditional crawl with kickoff job', { crawlId: id, url });
      await addCrawlJobToQueue(id, {
        url,
        mode: 'kickoff',
        scrapeOptions: { ...scrapeOptions, useBrowser },
        webhook,
      }, 10);
    }

    // Return success response with crawl ID
    const protocol = req.secure ? 'https' : 'http';
    const crawlType = useMapDiscovery ? 'Streaming crawl' : 'Traditional crawl';
    const message = useMapDiscovery 
      ? 'Streaming crawl initiated successfully. URLs are being discovered and scraped in real-time. Individual pages will be exported as markdown files.'
      : 'Traditional crawl initiated successfully. Individual pages will be exported as markdown files.';

    res.status(200).json({
      success: true,
      id,
      url: `${protocol}://${req.get('host')}/api/crawl/${id}`,
      message,
      outputDirectory: fileExportService.getCrawlOutputDir(id),
      crawlType,
      streamingEnabled: useMapDiscovery
    });
  } catch (error: any) {
    logger.error('Error initiating crawl', { error });
    res.status(500).json({
      success: false,
      error: error.message ?? 'Internal server error'
    });
  }
}

/**
 * Get the status of a crawl job
 */
export async function getCrawlStatus(
  req: Request<CrawlStatusParams, CrawlStatusResponse, {}, CrawlStatusQuery>,
  res: Response<CrawlStatusResponse>
): Promise<void> {
  try {
    const { jobId } = req.params;
    const start = req.query.skip ? parseInt(req.query.skip, 10) : 0;
    const pageSize = req.query.limit ? parseInt(req.query.limit, 10) : 20;

    // Get crawl data
    const storedCrawl = await getCrawl(jobId);
    if (!storedCrawl) {
      res.status(404).json({ success: false, error: 'Crawl not found' });
      return;
    }

    // Status is derived entirely from Redis counters (NOT from BullMQ job objects,
    // which are removed after completion and whose ids never matched the tracked
    // UUIDs — the old approach left every crawl stuck at "scraping" forever).
    const cancelled = await isCrawlCancelled(jobId);
    const progress = await getCrawlProgress(jobId);
    const finished = await isCrawlFinished(jobId);

    let status: 'completed' | 'cancelled' | 'scraping';
    if (cancelled) {
      status = 'cancelled';
    } else {
      status = finished ? 'completed' : 'scraping';
    }

    // Read stored per-job result documents (paginated over the success set).
    const successIds = await getCrawlDoneJobs(jobId, start, start + pageSize - 1);
    const jobResults = await Promise.all(
      successIds.map(async id => {
        const result = await getCrawlJobResult(jobId, id);
        if (!result) return null;
        const document = result.document ?? result;
        return { id, status: 'completed', document };
      })
    );
    const jobs = jobResults.filter((j): j is { id: string; status: string; document: any } => j !== null);

    // Get exported files information
    const exportedFiles = await getExportedFiles(jobId);

    res.status(200).json({
      success: true,
      status,
      crawl: storedCrawl,
      jobs,
      count: progress.success,
      progress: {
        total: progress.total,
        completed: progress.success,
        failed: progress.failed,
        pending: Math.max(0, progress.total - progress.done)
      },
      exportedFiles: {
        count: exportedFiles.length,
        outputDirectory: fileExportService.getCrawlOutputDir(jobId),
        files: exportedFiles.slice(0, 10) // Show first 10 files to avoid huge responses
      }
    });
  } catch (error: any) {
    logger.error('Error getting crawl status', { error });
    res.status(500).json({
      success: false,
      error: error.message ?? 'Internal server error'
    });
  }
}

/**
 * Cancel a running crawl
 */
export async function cancelCrawlJob(
  req: Request<CrawlStatusParams>,
  res: Response<CrawlCancelResponse>
): Promise<void> {
  try {
    const { jobId } = req.params;
    
    // Get crawl data
    const storedCrawl = await getCrawl(jobId);
    if (!storedCrawl) {
      res.status(404).json({ success: false, error: 'Crawl not found' });
      return;
    }
    
    // Mark as cancelled
    await cancelCrawl(jobId);

    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Error cancelling crawl', { error });
    res.status(500).json({
      success: false,
      error: error.message ?? 'Internal server error'
    });
  }
}

/**
 * List the per-page errors (failed URLs) for a crawl.
 */
export async function getCrawlErrorsHandler(
  req: Request<CrawlStatusParams>,
  res: Response
): Promise<void> {
  try {
    const { jobId } = req.params;
    const storedCrawl = await getCrawl(jobId);
    if (!storedCrawl) {
      res.status(404).json({ success: false, error: 'Crawl not found' });
      return;
    }
    const errors = await getCrawlErrors(jobId);
    res.status(200).json({ success: true, count: errors.length, errors });
  } catch (error: any) {
    logger.error('Error getting crawl errors', { error });
    res.status(500).json({ success: false, error: error.message ?? 'Internal server error' });
  }
}

/**
 * List all currently-active crawls.
 */
export async function listActiveCrawls(_req: Request, res: Response): Promise<void> {
  try {
    const crawls = await getActiveCrawls();
    res.status(200).json({ success: true, count: crawls.length, crawls });
  } catch (error: any) {
    logger.error('Error listing active crawls', { error });
    res.status(500).json({ success: false, error: error.message ?? 'Internal server error' });
  }
}

/**
 * Stream crawl results as Server-Sent Events. Pushes each page as soon as it
 * completes (like an upstream project's incremental output), then a final `done` event.
 * This is the container-agnostic way to receive markdown continuously — no
 * dependency on the crawl-output filesystem. Consume with `curl -N`.
 */
export async function streamCrawl(
  req: Request<CrawlStatusParams>,
  res: Response
): Promise<void> {
  const { jobId } = req.params;
  const storedCrawl = await getCrawl(jobId);
  if (!storedCrawl) {
    res.status(404).json({ success: false, error: 'Crawl not found' });
    return;
  }

  // SSE headers.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.on('close', () => { closed = true; });

  const sent = new Set<string>();
  const pollMs = Number(process.env.CRAWL_STREAM_POLL_MS ?? 1000);
  const maxMs = Number(process.env.CRAWL_STREAM_MAX_MS ?? 30 * 60 * 1000);
  const startedAt = Date.now();

  send('open', { crawlId: jobId, message: 'streaming crawl results' });

  try {
    // Poll Redis for newly-completed pages and push them as they arrive.
    // eslint-disable-next-line no-constant-condition
    while (!closed) {
      const doneIds = await getCrawlDoneJobs(jobId, 0, -1);
      for (const id of doneIds) {
        if (sent.has(id)) continue;
        sent.add(id);
        const result = await getCrawlJobResult(jobId, id);
        if (result) {
          send('page', toPageRecord(result));
        }
      }

      const progress = await getCrawlProgress(jobId);
      send('progress', {
        total: progress.total,
        completed: progress.success,
        failed: progress.failed,
        pending: Math.max(0, progress.total - progress.done)
      });

      const cancelled = await isCrawlCancelled(jobId);
      const finished = await isCrawlFinished(jobId);
      if (cancelled || finished) {
        send('done', { status: cancelled ? 'cancelled' : 'completed', ...progress });
        break;
      }
      if (Date.now() - startedAt > maxMs) {
        send('done', { status: 'timeout', ...progress });
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } catch (error: any) {
    logger.error('Error streaming crawl', { error, crawlId: jobId });
    if (!closed) send('error', { error: error.message ?? 'stream error' });
  } finally {
    if (!closed) res.end();
  }
}

/**
 * Download all completed crawl pages as a ZIP of markdown (or JSON) files,
 * streamed from Redis — no dependency on the container filesystem.
 * Query: ?format=markdown|json (per-file format inside the zip).
 */
export async function downloadCrawlZip(
  req: Request<CrawlStatusParams>,
  res: Response
): Promise<void> {
  try {
    const { jobId } = req.params;
    const format = (req.query.format as string) || 'markdown';
    const storedCrawl = await getCrawl(jobId);
    if (!storedCrawl) {
      res.status(404).json({ success: false, error: 'Crawl not found' });
      return;
    }

    const doneIds = await getCrawlDoneJobs(jobId, 0, -1);
    if (doneIds.length === 0) {
      res.status(404).json({ success: false, error: 'No completed pages yet for this crawl' });
      return;
    }

    const timestamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename="crawl_${jobId}_${timestamp}.zip"`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      logger.error('Crawl ZIP archive error', { error: err.message, crawlId: jobId });
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to create ZIP' });
    });
    archive.pipe(res);

    const manifest: any[] = [];
    let index = 0;
    for (const id of doneIds) {
      const result = await getCrawlJobResult(jobId, id);
      if (!result) continue;
      const page = toPageRecord(result);
      const ext = format === 'json' ? 'json' : 'md';
      const filename = safeFilename(page.url, index++, ext);
      const content = format === 'json' ? JSON.stringify(page, null, 2) : page.markdown;
      archive.append(content || '', { name: filename });
      manifest.push({ url: page.url, title: page.title, file: filename });
    }
    archive.append(JSON.stringify({ crawlId: jobId, count: manifest.length, pages: manifest }, null, 2), { name: 'manifest.json' });
    await archive.finalize();
  } catch (error: any) {
    logger.error('Error creating crawl ZIP', { error });
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message ?? 'Internal server error' });
  }
}

/**
 * Download all completed crawl pages as a single consolidated JSON array,
 * streamed from Redis.
 */
export async function downloadCrawlJson(
  req: Request<CrawlStatusParams>,
  res: Response
): Promise<void> {
  try {
    const { jobId } = req.params;
    const storedCrawl = await getCrawl(jobId);
    if (!storedCrawl) {
      res.status(404).json({ success: false, error: 'Crawl not found' });
      return;
    }

    const doneIds = await getCrawlDoneJobs(jobId, 0, -1);
    const timestamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename="crawl_${jobId}_${timestamp}.json"`);
    res.setHeader('Content-Type', 'application/json');

    // Stream the JSON array incrementally to avoid buffering large crawls in memory.
    res.write(`{"crawlId":${JSON.stringify(jobId)},"originUrl":${JSON.stringify(storedCrawl.originUrl)},"pages":[`);
    let first = true;
    for (const id of doneIds) {
      const result = await getCrawlJobResult(jobId, id);
      if (!result) continue;
      if (!first) res.write(',');
      first = false;
      res.write(JSON.stringify(toPageRecord(result)));
    }
    res.write(`],"count":${doneIds.length}}`);
    res.end();
  } catch (error: any) {
    logger.error('Error creating crawl JSON', { error });
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message ?? 'Internal server error' });
  }
}