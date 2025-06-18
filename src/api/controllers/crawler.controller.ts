import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { 
  CrawlRequest, 
  CrawlResponse, 
  CrawlStatusParams, 
  CrawlStatusQuery, 
  CrawlStatusResponse,
  CrawlCancelResponse,
  StoredCrawl
} from '../../types/crawler';
import { logger } from '../../utils/logger';
import { WebCrawler } from '../../scraper/crawler';
import { 
  saveCrawl, 
  getCrawl, 
  getCrawlJobs, 
  getCrawlDoneJobs,
  getCrawlDoneJobsCount,
  cancelCrawl,
  isCrawlFinished,
  getExportedFiles
} from '../../services/redis.service';
import { getJob, getJobs, addCrawlJobToQueue } from '../../services/queue.service';
import { fileExportService } from '../../services/file-export.service';

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
      useBrowser = false
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
      robotsTxt = await crawler.getRobotsTxt(scrapeOptions.skipTlsVerification || false);
      crawler.importRobotsTxt(robotsTxt);
    } catch (error) {
      logger.debug('Failed to get robots.txt (this is probably fine!)', { error });
    }

    // Store crawl information in Redis
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
      useBrowser,
      scrapeOptions,
      robots: robotsTxt
    });

    // Kickoff initial job to start the crawl
    await addCrawlJobToQueue(id, {
      url,
      mode: 'kickoff',
      scrapeOptions: {
        ...scrapeOptions,
        useBrowser  // Pass browser option to scrape options
      },
      webhook,
    }, 10);

    // Return success response with crawl ID
    const protocol = req.secure ? 'https' : 'http';
    res.status(200).json({
      success: true,
      id,
      url: `${protocol}://${req.get('host')}/api/crawl/${id}`,
      message: 'Crawl initiated successfully. Individual pages will be exported as markdown files.',
      outputDirectory: fileExportService.getCrawlOutputDir(id)
    });
  } catch (error: any) {
    logger.error('Error initiating crawl', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
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
    const end = req.query.limit 
      ? start + parseInt(req.query.limit, 10) - 1 
      : undefined;

    // Get crawl data
    const storedCrawl = await getCrawl(jobId);
    if (!storedCrawl) {
      res.status(404).json({ success: false, error: 'Crawl not found' });
      return;
    }

    // Get all job IDs for this crawl
    const jobIds = await getCrawlJobs(jobId);
    
    // Get job statuses
    const jobStatusPromises = jobIds.map(async (id) => {
      const job = await getJob(id);
      return { id, status: job ? await job.getState() : 'unknown' };
    });
    
    const jobStatuses = await Promise.all(jobStatusPromises);
    
    // Determine overall status
    const status = storedCrawl.cancelled
      ? 'cancelled'
      : jobStatuses.every(j => j.status === 'completed') && await isCrawlFinished(jobId)
        ? 'completed'
        : 'scraping';

    // Get completed jobs data
    const doneCount = await getCrawlDoneJobsCount(jobId);
    const doneJobIds = await getCrawlDoneJobs(jobId, start, end ?? -1);
    const doneJobs = await getJobs(doneJobIds);
    
    // Get exported files information
    const exportedFiles = await getExportedFiles(jobId);
    
    // Format jobs for response
    const jobs = await Promise.all(doneJobs.map(async job => {
      const jobState = await job.getState();
      const returnValue = job.returnvalue;
      
      // Make sure to include content and contentType at the document level
      let document = returnValue?.document || returnValue;
      
      // Ensure we keep the content fields if they exist at the top level
      if (returnValue && returnValue.content && !document.content) {
        document.content = returnValue.content;
      }
      
      if (returnValue && returnValue.contentType && !document.contentType) {
        document.contentType = returnValue.contentType;
      }
      
      // Log to debug what we're returning
      logger.debug(`Job ${job.id} document: ${document ? 'has document' : 'no document'}, ` +
        `content length: ${document?.content?.length || 0}, ` +
        `content type: ${document?.contentType || 'none'}`);
        
      return {
        id: job.id as string,
        status: jobState,
        document: document,
        error: job.failedReason
      };
    }));

    res.status(200).json({
      success: true,
      status,
      crawl: storedCrawl,
      jobs,
      count: doneCount,
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
      error: error.message || 'Internal server error'
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
      error: error.message || 'Internal server error'
    });
  }
} 