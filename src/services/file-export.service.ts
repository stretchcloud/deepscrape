import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

/**
 * Service for exporting crawled content to files
 */
export interface ExportOptions {
  format?: 'markdown' | 'html' | 'json';
  includeMetadata?: boolean;
  compression?: boolean;
  maxFileSize?: number;
}

export class FileExportService {
  private outputDir: string;
  
  constructor(outputDir?: string) {
    this.outputDir = outputDir || process.env.CRAWL_OUTPUT_DIR || './crawl-output';
    this.ensureOutputDirectory();
  }

  /**
   * Ensure the output directory exists
   */
  private ensureOutputDirectory(): void {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        logger.info(`Created crawl output directory: ${this.outputDir}`);
      }
    } catch (error) {
      logger.error(`Failed to create output directory: ${this.outputDir}`, { error });
      throw error;
    }
  }

  /**
   * Generate a safe filename from URL
   */
  private generateFilename(url: string, crawlId: string): string {
    try {
      const parsedUrl = new URL(url);
      
      // Create a safe filename from the URL
      let filename = parsedUrl.hostname;
      
      if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
        // Clean up the pathname to be filesystem-safe
        const cleanPath = parsedUrl.pathname
          .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
          .replace(/[^a-zA-Z0-9\-_.]/g, '_') // Replace unsafe characters with underscore
          .replace(/_+/g, '_') // Replace multiple underscores with single
          .substring(0, 100); // Limit length
        
        if (cleanPath) {
          filename += '_' + cleanPath;
        }
      }
      
      // Add query parameters if present (truncated)
      if (parsedUrl.search) {
        const queryString = parsedUrl.search
          .substring(1) // Remove leading ?
          .replace(/[^a-zA-Z0-9\-_.=&]/g, '_')
          .substring(0, 50); // Limit length
        filename += '_' + queryString;
      }
      
      // Ensure the filename is not too long
      if (filename.length > 150) {
        filename = filename.substring(0, 150);
      }
      
      // Add timestamp and crawl ID for uniqueness
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      filename = `${timestamp}_${crawlId.substring(0, 8)}_${filename}`;
      
      return filename + '.md';
    } catch (error) {
      // Fallback to a simple filename if URL parsing fails
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const hash = Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
      return `${timestamp}_${crawlId.substring(0, 8)}_${hash}.md`;
    }
  }

  /**
   * Export a single page's content to markdown file
   */
  async exportPage(
    url: string, 
    content: string, 
    title: string, 
    crawlId: string,
    metadata?: any
  ): Promise<string> {
    try {
      // Generate filename
      const filename = this.generateFilename(url, crawlId);
      const filepath = path.join(this.outputDir, crawlId, filename);
      
      // Ensure crawl-specific directory exists
      const crawlDir = path.join(this.outputDir, crawlId);
      if (!fs.existsSync(crawlDir)) {
        fs.mkdirSync(crawlDir, { recursive: true });
      }
      
      // Prepare markdown content with metadata
      const markdownContent = this.formatMarkdownContent(url, title, content, metadata);
      
      // Write file
      await fs.promises.writeFile(filepath, markdownContent, 'utf8');
      
      logger.info(`Exported page to file: ${filepath}`, {
        url,
        crawlId,
        filename,
        contentLength: content.length
      });
      
      return filepath;
    } catch (error) {
      logger.error(`Failed to export page to file`, {
        url,
        crawlId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Format content as markdown with metadata header
   */
  private formatMarkdownContent(
    url: string, 
    title: string, 
    content: string, 
    metadata?: any
  ): string {
    const timestamp = new Date().toISOString();
    
    // Create YAML frontmatter
    const frontmatter = [
      '---',
      `url: "${url}"`,
      `title: "${title || 'Untitled'}"`,
      `crawled_at: "${timestamp}"`,
      metadata?.status ? `status: ${metadata.status}` : '',
      metadata?.contentType ? `content_type: "${metadata.contentType}"` : '',
      metadata?.loadTime ? `load_time: ${metadata.loadTime}ms` : '',
      metadata?.usedBrowser ? `browser_mode: ${metadata.usedBrowser}` : '',
      '---',
      ''
    ].filter(Boolean).join('\n');
    
    // Combine frontmatter with content
    return frontmatter + '\n' + (content || '');
  }

  /**
   * Export crawl summary with all discovered URLs
   */
  async exportCrawlSummary(
    crawlId: string,
    summary: {
      initialUrl: string;
      totalPages: number;
      successfulPages: number;
      failedPages: number;
      startTime: string;
      endTime: string;
      exportedFiles: string[];
      crawlOptions: any;
    }
  ): Promise<string> {
    try {
      const filename = `${crawlId}_summary.md`;
      const filepath = path.join(this.outputDir, crawlId, filename);
      
      const summaryContent = [
        '# Crawl Summary',
        '',
        `**Crawl ID:** ${crawlId}`,
        `**Initial URL:** ${summary.initialUrl}`,
        `**Start Time:** ${summary.startTime}`,
        `**End Time:** ${summary.endTime}`,
        `**Total Pages:** ${summary.totalPages}`,
        `**Successful:** ${summary.successfulPages}`,
        `**Failed:** ${summary.failedPages}`,
        '',
        '## Crawl Options',
        '```json',
        JSON.stringify(summary.crawlOptions, null, 2),
        '```',
        '',
        '## Exported Files',
        '',
        ...summary.exportedFiles.map(file => `- ${path.basename(file)}`),
        ''
      ].join('\n');
      
      await fs.promises.writeFile(filepath, summaryContent, 'utf8');
      
      logger.info(`Exported crawl summary: ${filepath}`, { crawlId });
      
      return filepath;
    } catch (error) {
      logger.error(`Failed to export crawl summary`, {
        crawlId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Get the output directory for a specific crawl
   */
  getCrawlOutputDir(crawlId: string): string {
    return path.join(this.outputDir, crawlId);
  }

  /**
   * Export crawl as a single consolidated markdown file
   */
  async exportCrawlAsConsolidatedFile(
    crawlId: string,
    format: 'markdown' | 'html' | 'json' = 'markdown'
  ): Promise<string> {
    try {
      const crawlDir = path.join(this.outputDir, crawlId);
      if (!fs.existsSync(crawlDir)) {
        throw new Error(`Crawl directory not found: ${crawlDir}`);
      }

      const files = await fs.promises.readdir(crawlDir);
      const markdownFiles = files.filter(file => file.endsWith('.md') && !file.includes('_summary.md'));
      
      const consolidatedFilename = `${crawlId}_consolidated.${format}`;
      const consolidatedPath = path.join(crawlDir, consolidatedFilename);
      
      if (format === 'markdown') {
        let consolidatedContent = `# Consolidated Crawl Results\n\n**Crawl ID:** ${crawlId}\n**Generated:** ${new Date().toISOString()}\n**Total Files:** ${markdownFiles.length}\n\n---\n\n`;
        
        for (const file of markdownFiles) {
          const filePath = path.join(crawlDir, file);
          const content = await fs.promises.readFile(filePath, 'utf8');
          
          // Extract title from frontmatter or filename
          const titleMatch = content.match(/^title: "(.*?)"$/m);
          const title = titleMatch ? titleMatch[1] : file.replace('.md', '');
          
          consolidatedContent += `## ${title}\n\n`;
          
          // Remove frontmatter and add content
          const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\n/, '');
          consolidatedContent += contentWithoutFrontmatter + '\n\n---\n\n';
        }
        
        await fs.promises.writeFile(consolidatedPath, consolidatedContent, 'utf8');
      } else if (format === 'json') {
        const jsonData = {
          crawlId,
          generatedAt: new Date().toISOString(),
          totalFiles: markdownFiles.length,
          pages: []
        };
        
        for (const file of markdownFiles) {
          const filePath = path.join(crawlDir, file);
          const content = await fs.promises.readFile(filePath, 'utf8');
          
          // Parse frontmatter
          const frontmatterMatch = content.match(/^---([\s\S]*?)---/);
          let metadata = {};
          if (frontmatterMatch) {
            try {
              // Simple YAML parsing for basic frontmatter
              const frontmatter = frontmatterMatch[1];
              frontmatter.split('\n').forEach(line => {
                const match = line.match(/^(\w+):\s*"?(.*?)"?$/);
                if (match) {
                  (metadata as any)[match[1]] = match[2];
                }
              });
            } catch (e) {
              // Ignore parsing errors
            }
          }
          
          const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\n/, '');
          
          (jsonData.pages as any).push({
            filename: file,
            metadata,
            content: contentWithoutFrontmatter
          });
        }
        
        await fs.promises.writeFile(consolidatedPath, JSON.stringify(jsonData, null, 2), 'utf8');
      }
      
      logger.info(`Exported consolidated ${format} file: ${consolidatedPath}`, { crawlId, format });
      return consolidatedPath;
    } catch (error) {
      logger.error(`Failed to export consolidated file`, {
        crawlId,
        format,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Clean up old crawl directories (older than specified days)
   */
  async cleanupOldCrawls(daysOld: number = 7): Promise<void> {
    try {
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      
      if (!fs.existsSync(this.outputDir)) {
        return;
      }
      
      const entries = await fs.promises.readdir(this.outputDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(this.outputDir, entry.name);
          const stats = await fs.promises.stat(dirPath);
          
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.promises.rm(dirPath, { recursive: true, force: true });
            logger.info(`Cleaned up old crawl directory: ${dirPath}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to cleanup old crawls`, { error: (error as Error).message });
    }
  }
}

// Export singleton instance
export const fileExportService = new FileExportService();