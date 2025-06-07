import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { batchScrapeService } from '../../services/batch-scrape.service';
import { BatchScrapeRequest } from '../../types';
import archiver from 'archiver';

/**
 * Controller for batch scraping operations
 */
export class BatchScrapeController {
  
  /**
   * Initiate a new batch scraping operation
   */
  async initiateBatch(req: Request, res: Response): Promise<void> {
    try {
      const batchRequest: BatchScrapeRequest = req.body;
      
      logger.info('Initiating batch scraping operation', {
        urlCount: batchRequest.urls.length,
        concurrency: batchRequest.concurrency,
        userAgent: req.get('User-Agent')
      });

      const result = await batchScrapeService.initiateBatch(batchRequest);
      
      const statusUrl = `${req.protocol}://${req.get('host')}/api/batch/scrape/${result.batchId}/status`;
      
      res.status(202).json({
        success: true,
        batchId: result.batchId,
        totalUrls: result.totalUrls,
        message: 'Batch scraping initiated successfully',
        statusUrl,
        webhook: batchRequest.webhook,
        estimatedTime: result.estimatedTime
      });

    } catch (error) {
      logger.error('Failed to initiate batch scraping', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });

      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get batch scraping status and results
   */
  async getBatchStatus(req: Request, res: Response): Promise<void> {
    try {
      const { batchId } = req.params;
      
      logger.debug('Getting batch status', { batchId });

      const status = await batchScrapeService.getBatchStatus(batchId);
      
      res.json(status);

    } catch (error) {
      logger.error('Failed to get batch status', {
        batchId: req.params.batchId,
        error: (error as Error).message
      });

      if ((error as Error).message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: (error as Error).message
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }

  /**
   * Cancel a batch scraping operation
   */
  async cancelBatch(req: Request, res: Response): Promise<void> {
    try {
      const { batchId } = req.params;
      
      logger.info('Cancelling batch operation', { batchId });

      await batchScrapeService.cancelBatch(batchId);
      
      res.json({
        success: true,
        message: 'Batch operation cancelled successfully'
      });

    } catch (error) {
      logger.error('Failed to cancel batch operation', {
        batchId: req.params.batchId,
        error: (error as Error).message
      });

      if ((error as Error).message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: (error as Error).message
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }

  /**
   * Download individual result by job ID
   */
  async downloadResult(req: Request, res: Response): Promise<void> {
    try {
      const { batchId, jobId } = req.params;
      const format = (req.query.format as string) || 'json';
      
      logger.debug('Downloading individual result', { batchId, jobId, format });

      const result = await batchScrapeService.getJobResult(batchId, jobId);
      
      if (!result) {
        res.status(404).json({
          success: false,
          error: 'Result not found'
        });
        return;
      }

      // Generate filename based on URL and format
      const url = new URL(result.url);
      const hostname = url.hostname.replace(/[^a-zA-Z0-9]/g, '_');
      const timestamp = new Date().toISOString().split('T')[0];
      
      if (format === 'markdown' && result.contentType === 'markdown') {
        const filename = `${hostname}_${jobId}_${timestamp}.md`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'text/markdown');
        res.send(result.content);
      } else if (format === 'html' && result.contentType === 'html') {
        const filename = `${hostname}_${jobId}_${timestamp}.html`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'text/html');
        res.send(result.content);
      } else if (format === 'text') {
        const filename = `${hostname}_${jobId}_${timestamp}.txt`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'text/plain');
        res.send(result.content);
      } else {
        // Default to JSON
        const filename = `${hostname}_${jobId}_${timestamp}.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/json');
        res.json(result);
      }

    } catch (error) {
      logger.error('Failed to download result', {
        batchId: req.params.batchId,
        jobId: req.params.jobId,
        error: (error as Error).message
      });

      if ((error as Error).message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: (error as Error).message
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }

  /**
   * Download all results as a ZIP file
   */
  async downloadBatchZip(req: Request, res: Response): Promise<void> {
    try {
      const { batchId } = req.params;
      const format = (req.query.format as string) || 'markdown';
      
      logger.info('Creating ZIP download for batch', { batchId, format });

      const status = await batchScrapeService.getBatchStatus(batchId);
      
      if (!status.success || !status.results || status.results.length === 0) {
        res.status(404).json({
          success: false,
          error: 'No completed results found for this batch'
        });
        return;
      }

      // Set response headers for ZIP download
      const timestamp = new Date().toISOString().split('T')[0];
      const zipFilename = `batch_${batchId}_${timestamp}.zip`;
      
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      res.setHeader('Content-Type', 'application/zip');

      // Create ZIP archive
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });

      // Handle archive errors
      archive.on('error', (err) => {
        logger.error('ZIP archive error', { error: err.message });
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to create ZIP archive'
          });
        }
      });

      // Pipe archive to response
      archive.pipe(res);

      // Add files to archive
      for (let i = 0; i < status.results.length; i++) {
        const result = status.results[i];
        const url = new URL(result.url);
        const hostname = url.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        const pathname = url.pathname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        
        let filename: string;
        let content: string;
        let extension: string;

        if (format === 'markdown' && result.contentType === 'markdown') {
          extension = 'md';
          content = result.content;
        } else if (format === 'html' && result.contentType === 'html') {
          extension = 'html';
          content = result.content;
        } else if (format === 'text') {
          extension = 'txt';
          content = result.content;
        } else {
          extension = 'json';
          content = JSON.stringify(result, null, 2);
        }

        filename = `${i + 1}_${hostname}${pathname}.${extension}`;
        
        // Add file to archive
        archive.append(content, { name: filename });
      }

      // Add a summary file
      const summary = {
        batchId,
        generatedAt: new Date().toISOString(),
        totalFiles: status.results.length,
        completedUrls: status.completedUrls,
        failedUrls: status.failedUrls,
        processingTime: status.processingTime,
        urls: status.results.map(r => r.url)
      };
      
      archive.append(JSON.stringify(summary, null, 2), { name: 'batch_summary.json' });

      // Finalize the archive
      await archive.finalize();

    } catch (error) {
      logger.error('Failed to create ZIP download', {
        batchId: req.params.batchId,
        error: (error as Error).message
      });

      if (!res.headersSent) {
        if ((error as Error).message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: (error as Error).message
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Internal server error'
          });
        }
      }
    }
  }

  /**
   * Download all results in a single JSON file
   */
  async downloadBatchJson(req: Request, res: Response): Promise<void> {
    try {
      const { batchId } = req.params;
      
      logger.debug('Downloading batch results as JSON', { batchId });

      const status = await batchScrapeService.getBatchStatus(batchId);
      
      if (!status.success || !status.results || status.results.length === 0) {
        res.status(404).json({
          success: false,
          error: 'No completed results found for this batch'
        });
        return;
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `batch_${batchId}_${timestamp}.json`;
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      
      res.json({
        batchId,
        generatedAt: new Date().toISOString(),
        summary: {
          totalUrls: status.totalUrls,
          completedUrls: status.completedUrls,
          failedUrls: status.failedUrls,
          processingTime: status.processingTime,
          progress: status.progress
        },
        results: status.results
      });

    } catch (error) {
      logger.error('Failed to download batch JSON', {
        batchId: req.params.batchId,
        error: (error as Error).message
      });

      if ((error as Error).message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: (error as Error).message
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }

  /**
   * Clean up old batch data
   */
  async cleanup(req: Request, res: Response): Promise<void> {
    try {
      const olderThanDays = parseInt(req.query.days as string) || 7;
      
      logger.info('Starting batch cleanup', { olderThanDays });

      await batchScrapeService.cleanup(olderThanDays);
      
      res.json({
        success: true,
        message: `Cleanup completed for batches older than ${olderThanDays} days`
      });

    } catch (error) {
      logger.error('Failed to cleanup batches', {
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
}

// Export singleton instance
export const batchScrapeController = new BatchScrapeController();