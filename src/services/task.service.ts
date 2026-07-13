import { Job, Worker } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from './redis.service';
import { EnhancedQueueService } from './enhanced-queue.service';
import { logger } from '../utils/logger';
import scraperManager from '../scraper/scraper-manager';
import { URLDiscoveryService } from './url-discovery.service';
import { runAgent, AgentParams } from './agent.service';

/**
 * Generic async task queue (BullMQ-backed) for jobs that don't fit the crawl
 * model: multi-URL LLM `extract`, `llmstxt` generation, and async single-URL
 * `scrape`. Reliable by construction — persistent, retried, and scalable with
 * ROLE=worker, unlike the legacy in-process setImmediate batch path.
 *
 * Task lifecycle is tracked in Redis at `task:{id}` so status survives worker
 * restarts and is readable from the (stateless) web tier.
 */

export type TaskType = 'extract' | 'llmstxt' | 'scrape' | 'agent';

export interface TaskRecord {
  id: string;
  type: TaskType;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

const QUEUE_NAME = 'deepscrape-tasks';
const TASK_TTL = 24 * 60 * 60;

const taskQueue = new EnhancedQueueService(QUEUE_NAME, {
  concurrency: parseInt(process.env.TASK_CONCURRENCY || '3', 10),
  retryAttempts: 2,
});

async function saveTask(task: TaskRecord): Promise<void> {
  await redisClient.set(`task:${task.id}`, JSON.stringify(task), 'EX', TASK_TTL);
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  const raw = await redisClient.get(`task:${id}`);
  return raw ? (JSON.parse(raw) as TaskRecord) : null;
}

/** Create + enqueue a task, returning its id. */
export async function createTask(type: TaskType, params: any): Promise<string> {
  const id = uuidv4();
  const task: TaskRecord = { id, type, status: 'pending', createdAt: Date.now() };
  await saveTask(task);
  await taskQueue.addJob(id, { taskId: id, type, params }, { jobId: id });
  logger.info(`Task ${id} (${type}) created`);
  return id;
}

export async function initTaskQueue(): Promise<void> {
  await taskQueue.bullQueue.waitUntilReady();
}

export function initTaskWorker(): Worker {
  const worker = taskQueue.initializeWorker(async (job: Job) => {
    const { taskId, type, params } = job.data;
    const task: TaskRecord = (await getTask(taskId)) ?? { id: taskId, type, status: 'pending', createdAt: Date.now() };
    task.status = 'processing';
    await saveTask(task);

    try {
      let result: any;
      if (type === 'extract') result = await handleExtract(params);
      else if (type === 'llmstxt') result = await handleLlmsTxt(params);
      else if (type === 'scrape') result = await handleScrape(params);
      else if (type === 'agent') result = await runAgent(params as AgentParams);
      else throw new Error(`Unknown task type: ${type}`);

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      await saveTask(task);
      return result;
    } catch (err) {
      task.status = 'failed';
      task.error = (err as Error).message;
      task.completedAt = Date.now();
      await saveTask(task);
      throw err;
    }
  });
  logger.info('Task worker initialized');
  return worker;
}

export async function closeTaskQueue(): Promise<void> {
  await taskQueue.close();
}

// --- Handlers ---

/** Run a bounded-concurrency map over items. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  if (workers.length) await Promise.all(workers);
  return out;
}

/**
 * Multi-URL LLM extraction. `urls` may be given directly, or a single `url` can
 * be expanded via map discovery when `urls` is omitted (the "don't need the URLs
 * upfront" capability). Each page is scraped + schema-extracted, then aggregated.
 */
async function handleExtract(params: {
  urls?: string[];
  url?: string;
  prompt?: string;
  schema?: any;
  limit?: number;
  scrapeOptions?: any;
}): Promise<any> {
  let urls = Array.isArray(params.urls) ? params.urls.slice() : [];

  if (urls.length === 0 && params.url) {
    const discovery = new URLDiscoveryService();
    const res = await discovery.discoverUrls({ url: params.url, maxUrls: Math.min(params.limit ?? 20, 100), includeSubdomains: false });
    // Always include the seed URL itself — a site's own page is a valid extraction
    // target even when discovery surfaces no additional internal links.
    urls = Array.from(new Set([params.url, ...(res.links ?? [])])).slice(0, params.limit ?? 20);
  }
  if (urls.length === 0) {
    throw new Error('extract requires `urls` or a `url` to discover from');
  }

  const extractionOptions = { schema: params.schema, instructions: params.prompt, extractionType: 'structured' as const };
  const results = await mapLimit(urls, 3, async (url) => {
    try {
      const scrape = await scraperManager.scrape(url, {
        extractorFormat: 'markdown',
        preferHttpScraper: true,
        extractionOptions,
        ...(params.scrapeOptions || {}),
      });
      const ex = (scrape as { extractionResult?: any }).extractionResult;
      return { url, success: !!ex?.success, data: (scrape as { structuredData?: any }).structuredData, error: ex?.error || scrape.error, confidence: ex?.metadata?.confidence };
    } catch (err) {
      return { url, success: false, error: (err as Error).message, confidence: undefined };
    }
  });

  const data = results.filter(r => r.success).map(r => r.data);
  return { data, sources: results.map(r => ({ url: r.url, success: r.success, error: r.error, confidence: (r as { confidence?: any }).confidence })) };
}

/**
 * Generate `llms.txt` (and optionally `llms-full.txt`) for a site: discover URLs,
 * scrape each for title + description (+ full markdown), and format.
 */
async function handleLlmsTxt(params: { url: string; maxUrls?: number; includeFullText?: boolean }): Promise<any> {
  if (!params.url) throw new Error('llmstxt requires a `url`');
  const discovery = new URLDiscoveryService();
  const res = await discovery.discoverUrls({ url: params.url, maxUrls: Math.min(params.maxUrls ?? 100, 500), includeSubdomains: false });
  // Always include the seed URL so even a single-page site yields a valid llms.txt.
  const urls = Array.from(new Set([params.url, ...(res.links ?? [])])).slice(0, params.maxUrls ?? 100);

  const pages = await mapLimit(urls, 4, async (url) => {
    try {
      const scrape = await scraperManager.scrape(url, { extractorFormat: 'markdown', preferHttpScraper: true, onlyMainContent: true });
      if (scrape.error) return null;
      const md = scrape.content || '';
      const title = scrape.title || url;
      // First non-empty prose line as the description.
      const desc = md.split('\n').map(l => l.trim()).find(l => l.length > 30 && !l.startsWith('#') && !l.startsWith('[')) || '';
      return { url, title, description: desc.slice(0, 200), markdown: md };
    } catch {
      return null;
    }
  });

  const good = pages.filter(Boolean) as Array<{ url: string; title: string; description: string; markdown: string }>;
  const host = (() => { try { return new URL(params.url).hostname; } catch { return params.url; } })();

  const llmstxt =
    `# ${host}\n\n` +
    `> Auto-generated index of ${good.length} pages from ${params.url}.\n\n` +
    `## Pages\n\n` +
    good.map(p => `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ''}`).join('\n') + '\n';

  const out: any = { host, pageCount: good.length, llmstxt };
  if (params.includeFullText) {
    out.llmsFullTxt =
      `# ${host}\n\n` +
      good.map(p => `## ${p.title}\nURL: ${p.url}\n\n${p.markdown}`).join('\n\n---\n\n') + '\n';
  }
  return out;
}

/** Async single-URL scrape. */
async function handleScrape(params: { url: string; options?: any }): Promise<any> {
  if (!params.url) throw new Error('scrape requires a `url`');
  return scraperManager.scrape(params.url, params.options || {});
}
