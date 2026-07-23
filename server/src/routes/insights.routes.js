import { Router } from 'express';
import { Insight } from '../models/Insight.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, scopedClientFilter, canAccessClient } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

// Scoped insight feed. Optional ?client= and ?severity= filters.
router.get(
  '/',
  requirePermission(PERMISSIONS.CLIENT_READ),
  asyncHandler(async (req, res) => {
    const scope = scopedClientFilter(req.user); // null => all
    const filter = {};
    if (scope) filter.client = scope._id ? scope._id : { $in: [] };
    if (req.query.client) {
      if (!canAccessClient(req.user, req.query.client)) throw new HttpError(403, 'Client not in your scope');
      filter.client = req.query.client;
    }
    if (req.query.severity) filter.severity = req.query.severity;
    const insights = await Insight.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ insights });
  })
);

router.post(
  '/:id/acknowledge',
  requirePermission(PERMISSIONS.CLIENT_READ),
  asyncHandler(async (req, res) => {
    const insight = await Insight.findById(req.params.id);
    if (!insight) throw new HttpError(404, 'Insight not found');
    if (insight.client && !canAccessClient(req.user, insight.client)) throw new HttpError(403, 'Out of scope');
    insight.acknowledged = true;
    await insight.save();
    res.json({ insight });
  })
);

// Admin audit trail.
router.get(
  '/audit/logs',
  requirePermission(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req, res) => {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ logs });
  })
);

export default router;
