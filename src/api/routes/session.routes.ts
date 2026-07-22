import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter, statusLimiter } from '../middleware/rate-limit.middleware';
import {
  sessionManager,
  SessionAction,
  SessionNotFoundError,
  SessionCapacityError,
} from '../../services/session-manager.service';
import { logger } from '../../utils/logger';
import { sessionCreateSchema, sessionActionSchema } from '../schemas';

const router = Router();

/**
 * @route POST /api/sessions
 * @desc  Create a persistent interactive browser session.
 */
router.post('/', expensiveLimiter, apiKeyAuth, validateRequest(sessionCreateSchema), async (req: Request, res: Response) => {
  try {
    const info = await sessionManager.createSession(req.body);
    res.status(201).json({ success: true, session: info });
  } catch (error) {
    if (error instanceof SessionCapacityError) {
      return res.status(429).json({ success: false, error: (error as Error).message });
    }
    logger.error(`Create session failed: ${(error as Error).message}`);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

/**
 * @route GET /api/sessions
 * @desc  List active sessions.
 */
router.get('/', statusLimiter, apiKeyAuth, (_req: Request, res: Response) => {
  res.json({ success: true, count: sessionManager.listSessions().length, sessions: sessionManager.listSessions() });
});

/**
 * @route GET /api/sessions/:id
 * @desc  Session status (current URL/title, timestamps).
 */
router.get('/:id', statusLimiter, apiKeyAuth, (req: Request, res: Response) => {
  const info = sessionManager.getSession(req.params.id);
  if (!info) return res.status(404).json({ success: false, error: 'Session not found' });
  res.json({ success: true, session: info });
});

/**
 * @route POST /api/sessions/:id/action
 * @desc  Run one action against the session (navigate/click/type/scrape/...).
 */
router.post('/:id/action', expensiveLimiter, apiKeyAuth, validateRequest(sessionActionSchema.passthrough()), async (req: Request, res: Response) => {
  try {
    const result = await sessionManager.runAction(req.params.id, req.body as SessionAction);
    const info = sessionManager.getSession(req.params.id);
    res.json({ success: true, result, session: info });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return res.status(404).json({ success: false, error: (error as Error).message });
    }
    logger.error(`Session action failed: ${(error as Error).message}`);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

/**
 * @route DELETE /api/sessions/:id
 * @desc  Close a session and free its browser context.
 */
router.delete('/:id', statusLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  const closed = await sessionManager.closeSession(req.params.id);
  if (!closed) return res.status(404).json({ success: false, error: 'Session not found' });
  res.json({ success: true, closed: true });
});

export default router;
