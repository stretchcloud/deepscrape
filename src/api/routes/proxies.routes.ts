import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import { statusLimiter } from '../middleware/rate-limit.middleware';
import { proxyService } from '../../services/proxy.service';

const router = Router();

/**
 * @route GET /api/proxies
 * @desc  Proxy-pool status: configured count, currently-healthy count, and
 *        per-proxy health. (Rotation only — no CAPTCHA/unlocker component.)
 * @access Private (API key required)
 */
router.get('/', statusLimiter, apiKeyAuth, (_req: Request, res: Response) => {
  res.json({ success: true, ...proxyService.stats() });
});

export default router;
