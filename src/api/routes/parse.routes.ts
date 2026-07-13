import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { expensiveLimiter } from '../middleware/rate-limit.middleware';
import { parseDocument } from '../../services/document-parser.service';
import { logger } from '../../utils/logger';

const router = Router();

const parseSchema = z.object({
  content: z.string().optional(), // base64
  url: z.string().url().optional(),
  contentType: z.string().max(100).optional(),
}).refine(d => d.content || d.url, { message: 'Provide `content` (base64) or `url`' });

/**
 * @route POST /api/parse
 * @desc  Parse a PDF / DOCX / HTML document → markdown.
 * @access Private (API key required)
 */
router.post('/', expensiveLimiter, apiKeyAuth, validateRequest(parseSchema), async (req: Request, res: Response) => {
  try {
    const result = await parseDocument(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error(`Parse failed: ${(error as Error).message}`);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

export default router;
