import { logger } from '../utils/logger';
import { CacheService } from './cache.service';
import { fileExportService } from './file-export.service';

/**
 * Periodic housekeeping so on-disk artifacts can't grow without bound:
 *  - sweeps expired cache entries (cache only expires lazily on read otherwise)
 *  - deletes crawl output older than CRAWL_RETENTION_DAYS
 *
 * The interval is unref'd so it never keeps the process alive on its own, and is
 * cleared on shutdown.
 */

let timer: NodeJS.Timeout | undefined;

export function startMaintenance(): void {
  const intervalMs = Number(process.env.MAINTENANCE_INTERVAL_MS ?? 60 * 60 * 1000); // hourly
  const retentionDays = Number(process.env.CRAWL_RETENTION_DAYS ?? 7);
  const cache = new CacheService();

  const run = async () => {
    try {
      await cache.sweepExpired();
    } catch (err) {
      logger.error(`Cache sweep failed: ${(err as Error).message}`);
    }
    try {
      await fileExportService.cleanupOldCrawls(retentionDays);
    } catch (err) {
      logger.error(`Crawl output cleanup failed: ${(err as Error).message}`);
    }
  };

  // Run once shortly after boot, then on the interval.
  setTimeout(() => void run(), 30_000).unref();
  timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  logger.info(`Maintenance scheduler started (every ${Math.round(intervalMs / 60000)}m, crawl retention ${retentionDays}d)`);
}

export function stopMaintenance(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
