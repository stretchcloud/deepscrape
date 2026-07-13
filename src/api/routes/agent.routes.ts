import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter, statusLimiter } from '../middleware/rate-limit.middleware';
import { createTask, getTask } from '../../services/task.service';
import { logger } from '../../utils/logger';

const router = Router();

const agentSchema = z.object({
  url: z.string().url(),
  prompt: z.string().min(1).max(5000),
  schema: z.any().optional(),
  maxSteps: z.number().int().positive().max(20).optional(),
  onlyMainContent: z.boolean().optional(),
  fitMarkdown: z.boolean().optional(),
});

/**
 * @route POST /api/agent
 * @desc  Start an autonomous navigation agent toward a natural-language goal.
 *        Runs as an async task; poll GET /api/agent/:id for the result.
 */
router.post('/', expensiveLimiter, apiKeyAuth, validateRequest(agentSchema), async (req: Request, res: Response) => {
  try {
    const id = await createTask('agent', req.body);
    const base = `${req.secure ? 'https' : 'http'}://${req.get('host')}`;
    res.status(200).json({ success: true, id, url: `${base}/api/agent/${id}`, status: 'pending' });
  } catch (error) {
    logger.error(`Failed to create agent task: ${(error as Error).message}`);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * @route GET /api/agent/:id
 * @desc  Agent task status + result (steps taken, final answer/data).
 */
router.get('/:id', statusLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, ...task });
});

export default router;
