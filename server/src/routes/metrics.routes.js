import { Router } from 'express';
import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { decryptSecret } from '../lib/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canAccessClient, scopedClientFilter } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler } from '../middleware/error.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth, requirePermission(PERMISSIONS.CLIENT_READ));

// Only real lead/conversion actions — never clicks/views/likes.
const LEAD_ACTION = /(^lead$|leadgen|onsite_conversion\.lead|offsite_conversion|complete_registration|submit_application|purchase|contact|schedule|subscribe)/i;

function sumLeads(actions) {
  if (!Array.isArray(actions)) return 0;
  return actions.filter((a) => LEAD_ACTION.test(a.action_type || '')).reduce((s, a) => s + Number(a.value || 0), 0);
}

// Decrypt a client's stored Meta token.
async function getMetaToken(clientId) {
  const integ = await Integration.findOne({ client: clientId, provider: 'meta', status: 'connected' }).select('+credentials');
  const enc = integ?.credentials?.get?.('accessToken');
  return enc ? decryptSecret(enc) : null;
}

// Live pull from Meta Insights for one ad account + date preset.
async function metaInsights({ token, adAccountId, datePreset }) {
  const url = new URL(`https://graph.facebook.com/${env.META_API_VERSION}/act_${adAccountId}/insights`);
  url.searchParams.set('level', 'account');
  url.searchParams.set('fields', 'spend,impressions,clicks,ctr,cpc,actions');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.meta = true;
    throw e;
  }
  const row = (data.data && data.data[0]) || null;
  if (!row) return { spend: 0, clicks: 0, impressions: 0, conversions: 0, ctr: 0, cpc: 0 };
  return {
    spend: Number(row.spend || 0),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    cpc: Number(row.cpc || 0),
    conversions: sumLeads(row.actions),
  };
}

// GET /api/metrics/dashboard — LIVE from Meta (no DB snapshots).
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    // Pick the client: the requested one (if allowed), else the Skyup client.
    let clientId = req.query.clientId;
    if (clientId && !canAccessClient(req.user, clientId)) clientId = null;
    if (!clientId) {
      const filter = scopedClientFilter(req.user) || {};
      const skyup = await Client.findOne({ status: 'active', name: /skyup/i, ...filter }).lean();
      clientId = skyup?._id || (await Client.findOne({ status: 'active', ...filter }).lean())?._id;
    }
    const client = clientId ? await Client.findById(clientId).lean() : null;
    const adAccountId = client?.accountRefs?.metaAdAccountId;

    const out = { meta: { today: null, week: null }, googleAds: { week: null }, source: 'live', lastUpdated: new Date().toISOString() };

    if (!client) return res.json({ ...out, note: 'No client found' });
    if (!adAccountId) return res.json({ ...out, note: 'No Meta ad account id set on this client' });

    const token = await getMetaToken(clientId);
    if (!token) return res.json({ ...out, note: 'Meta not connected for this client' });

    try {
      const [today, week] = await Promise.all([
        metaInsights({ token, adAccountId, datePreset: 'today' }),
        metaInsights({ token, adAccountId, datePreset: 'last_7d' }),
      ]);
      const roas = () => 0; // real ROAS needs a purchase-value/pixel; omit rather than fake
      out.meta.today = {
        spend: Math.round(today.spend),
        conversions: today.conversions,
        roas: null,
      };
      out.meta.week = {
        spend: Math.round(week.spend),
        clicks: week.clicks,
        impressions: week.impressions,
        conversions: week.conversions,
        ctr: week.ctr ? week.ctr.toFixed(2) : '0',
        cpc: Math.round(week.cpc),
        roas: null,
      };
    } catch (e) {
      out.metaError = e.meta ? `Meta: ${e.message}` : e.message;
    }

    res.json(out);
  })
);

export default router;