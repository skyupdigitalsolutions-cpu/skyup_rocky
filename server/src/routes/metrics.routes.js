import { Router } from 'express';
import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { decryptSecret } from '../lib/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canAccessClient, scopedClientFilter } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler } from '../middleware/error.js';
import { env } from '../config/env.js';
import { crmConfigured, leadStats, leadsByAdSet } from '../lib/crm.js';

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

    // ---- CRM: real leads + conversions (Skyup company) ----------------------
    out.crm = null;
    if (crmConfigured()) {
      try {
        const [today, pipeline] = await Promise.all([leadStats('today'), leadStats('all')]);
        out.crm = {
          today: {
            total: today.total,
            new: today.newLeads,
            interested: today.interested,
            converted: today.converted,
            notInterested: today.notInterested,
            hot: today.hot, warm: today.warm, cold: today.cold,
          },
          pipeline: {
            total: pipeline.total,
            new: pipeline.newLeads,
            interested: pipeline.interested,
            converted: pipeline.converted,
            notInterested: pipeline.notInterested,
            hot: pipeline.hot, warm: pipeline.warm, cold: pipeline.cold,
          },
        };
      } catch (e) {
        out.crmError = e.message;
      }
    } else {
      out.crmError = 'CRM not connected (set CRM_MONGO_URI)';
    }

    res.json(out);
  })
);


// Per-ad-set spend from Meta (last N days), keyed by adset_id.
async function metaAdsetSpend({ token, adAccountId, datePreset }) {
  const url = new URL(`https://graph.facebook.com/${env.META_API_VERSION}/act_${adAccountId}/insights`);
  url.searchParams.set('level', 'adset');
  url.searchParams.set('fields', 'adset_id,adset_name,campaign_name,spend,clicks,actions');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('limit', '200');
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  const map = new Map();
  for (const r of data.data || []) {
    map.set(String(r.adset_id), {
      adsetId: String(r.adset_id),
      adsetName: r.adset_name || '',
      campaignName: r.campaign_name || '',
      spend: Number(r.spend || 0),
      clicks: Number(r.clicks || 0),
    });
  }
  return map;
}

// GET /api/metrics/attribution — the money view: per ad set,
// Meta spend joined to CRM leads + conversions => CPL & cost-per-conversion.
router.get(
  '/attribution',
  asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const preset = days <= 1 ? 'today' : days <= 7 ? 'last_7d' : days <= 14 ? 'last_14d' : days <= 30 ? 'last_30d' : 'last_90d';

    // Resolve Skyup client + token.
    let clientId = req.query.clientId;
    if (clientId && !canAccessClient(req.user, clientId)) clientId = null;
    if (!clientId) {
      const filter = scopedClientFilter(req.user) || {};
      const skyup = await Client.findOne({ status: 'active', name: /skyup/i, ...filter }).lean();
      clientId = skyup?._id;
    }
    const client = clientId ? await Client.findById(clientId).lean() : null;
    const adAccountId = client?.accountRefs?.metaAdAccountId;
    const out = { rows: [], totals: null, days, source: 'live' };
    if (!client || !adAccountId) { out.note = 'No Meta ad account id set'; return res.json(out); }
    if (!crmConfigured()) { out.note = 'CRM not connected'; return res.json(out); }

    const token = await getMetaToken(clientId);
    if (!token) { out.note = 'Meta not connected'; return res.json(out); }

    let spendMap;
    try {
      spendMap = await metaAdsetSpend({ token, adAccountId, datePreset: preset });
    } catch (e) {
      out.metaError = e.message;
      return res.json(out);
    }

    const crmRows = await leadsByAdSet(days);

    // Join CRM ad-set rows to Meta spend by metaAdsetId.
    const rows = crmRows.map((c) => {
      const spendRow = c.metaAdsetId ? spendMap.get(String(c.metaAdsetId)) : null;
      const spend = spendRow?.spend || 0;
      return {
        adSet: c.adSetName || spendRow?.adsetName || 'Unattributed',
        campaign: c.campaignName || spendRow?.campaignName || '',
        spend: Math.round(spend),
        leads: c.leads,
        conversions: c.converted,
        costPerLead: c.leads ? Math.round(spend / c.leads) : null,
        costPerConversion: c.converted ? Math.round(spend / c.converted) : null,
        convRate: c.leads ? Math.round((c.converted / c.leads) * 100) : 0,
        linked: Boolean(spendRow),
      };
    }).sort((a, b) => (b.spend || 0) - (a.spend || 0));

    const totLeads = rows.reduce((s, r) => s + r.leads, 0);
    const totConv = rows.reduce((s, r) => s + r.conversions, 0);
    const totSpend = rows.reduce((s, r) => s + r.spend, 0);
    out.rows = rows;
    out.totals = {
      spend: totSpend,
      leads: totLeads,
      conversions: totConv,
      costPerLead: totLeads ? Math.round(totSpend / totLeads) : null,
      costPerConversion: totConv ? Math.round(totSpend / totConv) : null,
      convRate: totLeads ? Math.round((totConv / totLeads) * 100) : 0,
    };
    // Best converting ad set (>=1 conversion, lowest cost-per-conversion).
    const withConv = rows.filter((r) => r.conversions > 0 && r.costPerConversion != null);
    out.bestAdSet = withConv.sort((a, b) => a.costPerConversion - b.costPerConversion)[0] || null;
    res.json(out);
  })
);

export default router;