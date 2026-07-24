import { Router } from 'express';
import { z } from 'zod';
import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { Document } from '../models/Document.js';
import { Insight } from '../models/Insight.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, scopedClientFilter, canAccessClient } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';

const router = Router();
router.use(requireAuth);

const serviceSchema = z.object({
  name: z.string(),
  status: z.enum(['active', 'paused', 'ended']).default('active'),
  monthlyBudget: z.number().nullable().optional(),
  notes: z.string().optional(),
});

const clientSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  website: z.string().optional(),
  status: z.enum(['active', 'prospect', 'paused', 'churned']).optional(),
  goals: z.string().optional(),
  targetMarket: z.string().optional(),
  brandNotes: z.string().optional(),
  services: z.array(serviceSchema).optional(),
  contacts: z.array(z.object({ name: z.string().optional(), role: z.string().optional(), email: z.string().optional(), phone: z.string().optional() })).optional(),
  accountRefs: z
    .object({
      metaAdAccountId: z.string().optional(),
      googleAdsCustomerId: z.string().optional(),
      gscSiteUrl: z.string().optional(),
      ga4PropertyId: z.string().optional(),
    })
    .optional(),
});

// List (scoped) with light health info.
router.get(
  '/',
  requirePermission(PERMISSIONS.CLIENT_READ),
  asyncHandler(async (req, res) => {
    const filter = scopedClientFilter(req.user) || {};
    // Never surface system knowledge-base clients in the UI — they're RAG containers, not real clients.
    filter.name = { $not: /knowledge base/i };
    const q = req.query.q;
    const find = q ? { ...filter, $text: { $search: String(q) } } : filter;
    const clients = await Client.find(find).sort({ updatedAt: -1 }).lean();
    res.json({ clients });
  })
);

// Detail with connected accounts, doc count, recent insights.
router.get(
  '/:id',
  requirePermission(PERMISSIONS.CLIENT_READ),
  asyncHandler(async (req, res) => {
    if (!canAccessClient(req.user, req.params.id)) throw new HttpError(403, 'Client not in your scope');
    const client = await Client.findById(req.params.id).lean();
    if (!client) throw new HttpError(404, 'Client not found');
    const [integrations, documentsCount, insights] = await Promise.all([
      Integration.find({ client: client._id }).lean(),
      Document.countDocuments({ client: client._id }),
      Insight.find({ client: client._id }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    res.json({
      client,
      integrations: integrations.map((i) => ({
        id: i._id,
        provider: i.provider,
        status: i.status,
        accountLabel: i.accountLabel,
        lastSyncAt: i.lastSyncAt,
        lastError: i.lastError,
      })),
      documentsCount,
      insights,
    });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  asyncHandler(async (req, res) => {
    const body = clientSchema.parse(req.body);
    const client = await Client.create({ ...body, createdBy: req.user._id });
    await audit(req, 'client.create', { targetType: 'client', targetId: client._id });
    res.status(201).json({ client });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  asyncHandler(async (req, res) => {
    if (!canAccessClient(req.user, req.params.id)) throw new HttpError(403, 'Client not in your scope');
    const body = clientSchema.partial().parse(req.body);
    const client = await Client.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!client) throw new HttpError(404, 'Client not found');
    await audit(req, 'client.update', { targetType: 'client', targetId: client._id });
    res.json({ client });
  })
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.CLIENT_WRITE),
  asyncHandler(async (req, res) => {
    if (!canAccessClient(req.user, req.params.id)) throw new HttpError(403, 'Client not in your scope');
    await Client.findByIdAndDelete(req.params.id);
    await audit(req, 'client.delete', { targetType: 'client', targetId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;