import { Router } from 'express';
import { z } from 'zod';
import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { decryptSecret } from '../lib/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canAccessClient } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';
import { draftCampaignPlan, createPausedCampaign, uploadAdImageFromUrl, adsConfigured } from '../services/metaAdsBuilder.js';

const router = Router();
router.use(requireAuth, requirePermission(PERMISSIONS.ADS_MANAGE));

// Resolve the client's connected Meta token (needs ads_management scope).
async function getMetaContext(user, clientId) {
  if (!canAccessClient(user, clientId)) throw new HttpError(403, 'Client not in your scope');
  const client = await Client.findById(clientId).lean();
  if (!client) throw new HttpError(404, 'Client not found');
  const adAccountId = client.accountRefs?.metaAdAccountId;
  if (!adAccountId) throw new HttpError(400, 'This client has no Meta ad account id (set accountRefs.metaAdAccountId).');
  const integ = await Integration.findOne({ client: clientId, provider: 'meta', status: 'connected' }).select('+credentials');
  const enc = integ?.credentials?.get?.('accessToken');
  const token = enc ? decryptSecret(enc) : null;
  if (!token) throw new HttpError(400, 'Meta is not connected for this client. Reconnect it (with ads_management) on the Integrations page.');
  return { client, adAccountId, token };
}

// 1) DRAFT — Rocky writes the plan (targeting + copy) from a goal. No writes to Meta.
router.post(
  '/draft',
  asyncHandler(async (req, res) => {
    const { clientId, goal, dailyBudgetInr } = z
      .object({ clientId: z.string(), goal: z.string().min(3), dailyBudgetInr: z.number().positive().optional() })
      .parse(req.body);
    if (!canAccessClient(req.user, clientId)) throw new HttpError(403, 'Client not in your scope');
    const client = await Client.findById(clientId).lean();
    if (!client) throw new HttpError(404, 'Client not found');
    const plan = await draftCampaignPlan({ client, goal, dailyBudgetInr: dailyBudgetInr || 500 });
    res.json({ plan });
  })
);

// 2) CREATE — build the campaign in Meta as PAUSED, return an Ads Manager link.
router.post(
  '/create',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        clientId: z.string(),
        plan: z.object({}).passthrough(),
        link: z.string().url(),
        pageId: z.string().optional(),
        imageUrl: z.string().url().optional(),
        objective: z.string().optional(),
        optimizationGoal: z.string().optional(),
      })
      .parse(req.body);

    if (!adsConfigured()) throw new HttpError(400, 'Meta app is not configured (set META_APP_ID + META_APP_SECRET).');
    const { client, adAccountId, token } = await getMetaContext(req.user, body.clientId);
    const pageId = body.pageId || client.accountRefs?.facebookPageId;
    if (!pageId) throw new HttpError(400, 'Missing Facebook Page id — pass pageId, or set accountRefs.facebookPageId on the client.');

    let imageHash;
    if (body.imageUrl) imageHash = await uploadAdImageFromUrl({ adAccountId, token, imageUrl: body.imageUrl });

    const result = await createPausedCampaign({
      token, adAccountId, pageId, plan: body.plan, link: body.link, imageHash,
      objective: body.objective || 'OUTCOME_TRAFFIC',
      optimizationGoal: body.optimizationGoal || 'LINK_CLICKS',
    });

    await audit(req, 'ads.create_paused', { targetType: 'client', targetId: client._id, meta: { campaignId: result.campaignId } });
    res.status(201).json({ result });
  })
);

export default router;