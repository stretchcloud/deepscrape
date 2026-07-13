import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter, statusLimiter } from '../middleware/rate-limit.middleware';
import { createTask, getTask, TaskType } from '../../services/task.service';
import { logger } from '../../utils/logger';

/** Shared status handler for async tasks. */
async function taskStatus(req: Request, res: Response): Promise<void> {
  const task = await getTask(req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }
  res.json({ success: true, ...task });
}

function makeCreateHandler(type: TaskType) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const id = await createTask(type, req.body);
      const base = `${req.secure ? 'https' : 'http'}://${req.get('host')}`;
      res.status(200).json({ success: true, id, url: `${base}/api/${type}/${id}`, status: 'pending' });
    } catch (error) {
      logger.error(`Failed to create ${type} task`, { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  };
}

// ---- /api/extract (async multi-URL LLM extraction) ----
export const extractRouter = Router();
const extractSchema = z.object({
  urls: z.array(z.string().url()).max(1000).optional(),
  url: z.string().url().optional(),
  prompt: z.string().max(5000).optional(),
  schema: z.any().optional(),
  limit: z.number().int().positive().max(1000).optional(),
  scrapeOptions: z.record(z.any()).optional(),
}).refine(d => (d.urls && d.urls.length > 0) || d.url, { message: 'Provide `urls` or a `url`' });
extractRouter.post('/', expensiveLimiter, apiKeyAuth, validateRequest(extractSchema), makeCreateHandler('extract'));
extractRouter.get('/:id', statusLimiter, apiKeyAuth, taskStatus);

// ---- /api/llmstxt (generate llms.txt for a site) ----
export const llmstxtRouter = Router();
const llmstxtSchema = z.object({
  url: z.string().url(),
  maxUrls: z.number().int().positive().max(500).optional(),
  includeFullText: z.boolean().optional(),
});
llmstxtRouter.post('/', expensiveLimiter, apiKeyAuth, validateRequest(llmstxtSchema), makeCreateHandler('llmstxt'));
llmstxtRouter.get('/:id', statusLimiter, apiKeyAuth, taskStatus);
