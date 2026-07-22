import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter } from '../middleware/rate-limit.middleware';
import { parseDocument } from '../../services/document-parser.service';
import { logger } from '../../utils/logger';
import { parseRequestSchema } from '../schemas';

const router = Router();

/**
 * @route POST /api/parse
 * @desc  Parse a PDF / DOCX / HTML document → markdown.
 * @access Private (API key required)
 */
router.post('/', expensiveLimiter, apiKeyAuth, validateRequest(parseRequestSchema), async (req: Request, res: Response) => {
  try {
    const result = await parseDocument(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error(`Parse failed: ${(error as Error).message}`);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

export default router;
