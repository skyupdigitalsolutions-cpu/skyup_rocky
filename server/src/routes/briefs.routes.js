import { Router } from 'express';
import { DailyBrief } from '../models/Insight.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';
import { generateMorningBrief } from '../jobs/morningBrief.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth, requirePermission(PERMISSIONS.BRIEF_READ));

// Latest brief (today's if present, otherwise most recent).
router.get(
  '/today',
  asyncHandler(async (req, res) => {
    const date = new Date().toLocaleDateString('en-CA', { timeZone: env.BRIEF_TIMEZONE });
    let brief = await DailyBrief.findOne({ date }).lean();
    if (!brief) brief = await DailyBrief.findOne().sort({ createdAt: -1 }).lean();
    res.json({ brief: brief || null });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const briefs = await DailyBrief.find().sort({ createdAt: -1 }).limit(30).lean();
    res.json({ briefs });
  })
);

// On-demand generation (also runs on the morning cron).
router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const brief = await generateMorningBrief();
    await audit(req, 'brief.generate', { targetType: 'brief', targetId: brief?._id });
    res.json({ brief });
  })
);

export default router;
