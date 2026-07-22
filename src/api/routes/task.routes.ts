import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter, statusLimiter } from '../middleware/rate-limit.middleware';
import { createTask, getTask, TaskType } from '../../services/task.service';
import { logger } from '../../utils/logger';
import { extractTaskSchema, llmstxtSchema } from '../schemas';

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
extractRouter.post('/', expensiveLimiter, apiKeyAuth, validateRequest(extractTaskSchema), makeCreateHandler('extract'));
extractRouter.get('/:id', statusLimiter, apiKeyAuth, taskStatus);

// ---- /api/llmstxt (generate llms.txt for a site) ----
export const llmstxtRouter = Router();
llmstxtRouter.post('/', expensiveLimiter, apiKeyAuth, validateRequest(llmstxtSchema), makeCreateHandler('llmstxt'));
llmstxtRouter.get('/:id', statusLimiter, apiKeyAuth, taskStatus);
