import { createHash } from 'crypto';
import { createTwoFilesPatch } from 'diff';
import { redisClient } from './redis.service';
import { logger } from '../utils/logger';

/**
 * Change tracking.
 *
 * On each scrape, we snapshot the page's main-content markdown keyed by the URL
 * (+ options that affect the content). On the next scrape of the same key we
 * compare hashes and report new/same/changed, plus a git-style diff and a
 * structured added/removed line summary.
 */

export type ChangeStatus = 'new' | 'same' | 'changed';

export interface ChangeTrackingResult {
  changeStatus: ChangeStatus;
  previousScrapeAt?: string;
  currentScrapeAt: string;
  diff?: {
    gitDiff: string;
    added: string[];
    removed: string[];
  };
}

const SNAPSHOT_TTL = Number(process.env.CHANGE_TRACKING_TTL ?? 30 * 24 * 60 * 60); // 30 days

function snapshotKey(url: string, optionsFingerprint: string): string {
  const h = createHash('sha256').update(`${url}::${optionsFingerprint}`).digest('hex').slice(0, 40);
  return `changetrack:${h}`;
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Compute added/removed lines between two texts (simple set-based summary). */
function lineDelta(previous: string, current: string): { added: string[]; removed: string[] } {
  const prev = new Set(previous.split('\n').map(l => l.trim()).filter(Boolean));
  const curr = new Set(current.split('\n').map(l => l.trim()).filter(Boolean));
  const added: string[] = [];
  const removed: string[] = [];
  for (const l of curr) if (!prev.has(l)) added.push(l);
  for (const l of prev) if (!curr.has(l)) removed.push(l);
  return { added: added.slice(0, 500), removed: removed.slice(0, 500) };
}

/**
 * Compare `currentContent` to the stored snapshot for (url, optionsFingerprint),
 * then persist the current content as the new snapshot.
 */
export async function computeChange(
  url: string,
  optionsFingerprint: string,
  currentContent: string
): Promise<ChangeTrackingResult> {
  const now = new Date().toISOString();
  const key = snapshotKey(url, optionsFingerprint);

  try {
    const prevRaw = await redisClient.get(key);
    const currHash = contentHash(currentContent);

    // Persist the new snapshot regardless of outcome.
    const store = JSON.stringify({ hash: currHash, content: currentContent, at: now });

    if (!prevRaw) {
      await redisClient.set(key, store, 'EX', SNAPSHOT_TTL);
      return { changeStatus: 'new', currentScrapeAt: now };
    }

    const prev = JSON.parse(prevRaw) as { hash: string; content: string; at: string };
    await redisClient.set(key, store, 'EX', SNAPSHOT_TTL);

    if (prev.hash === currHash) {
      return { changeStatus: 'same', previousScrapeAt: prev.at, currentScrapeAt: now };
    }

    const gitDiff = createTwoFilesPatch('previous', 'current', prev.content, currentContent, prev.at, now);
    return {
      changeStatus: 'changed',
      previousScrapeAt: prev.at,
      currentScrapeAt: now,
      diff: { gitDiff, ...lineDelta(prev.content, currentContent) },
    };
  } catch (err) {
    logger.error(`Change tracking failed for ${url}: ${(err as Error).message}`);
    return { changeStatus: 'new', currentScrapeAt: now };
  }
}
