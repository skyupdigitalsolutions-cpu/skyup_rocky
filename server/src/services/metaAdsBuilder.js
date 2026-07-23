import { env } from '../config/env.js';
import { llmChat } from '../llm/provider.js';

// Meta Marketing API — WRITE surface (campaign creation). Everything is created
// PAUSED. Nothing here ever spends money on its own: a human reviews + launches
// in Ads Manager. Requires a token with `ads_management` scope.

const API = () => `https://graph.facebook.com/${env.META_API_VERSION}`;

export function adsConfigured() {
  return Boolean(env.META_APP_ID && env.META_APP_SECRET);
}

// Low-level Graph POST/GET that surfaces Meta's real error text (so we can fix
// the exact field on the first live run).
async function graph(path, { token, method = 'GET', params = {} } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  body.append('access_token', token);
  const url = `${API()}/${path}`;
  const res = await fetch(url, method === 'GET' ? undefined : { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error || {};
    throw new Error(`Meta API error: ${e.error_user_title ? e.error_user_title + ' — ' : ''}${e.message || JSON.stringify(data)}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return data;
}

// ---- 1) AI drafts the plan from a plain-language goal -----------------------
// Returns a structured plan; targeting sent to the API is kept to geo/age/gender
// (reliable). Interest ideas are returned as TEXT for the human to add in Ads
// Manager (interest IDs need the Targeting Search API — a later add).
export async function draftCampaignPlan({ client, goal, dailyBudgetInr = 500 }) {
  const system =
    `You are Rocky, a senior performance marketer. Draft a lead-generation ad plan for the brand. ` +
    `Return STRICT JSON only (no markdown):\n` +
    `{\n` +
    `  "campaignName": "short descriptive name",\n` +
    `  "targeting": { "ageMin": 18-65, "ageMax": 18-65, "genders": "all|male|female", "countries": ["IN"], "suggestedInterests": ["3-6 interest names for the human to add"] },\n` +
    `  "dailyBudgetInr": number,\n` +
    `  "adCopy": { "primaryText": "1-3 lines, hook-first", "headline": "<=40 chars", "description": "<=30 chars", "cta": "LEARN_MORE|SIGN_UP|CONTACT_US|GET_QUOTE|BOOK_TRAVEL|DOWNLOAD" }\n` +
    `}\n\n` +
    `<BRAND>\nName: ${client?.name}\nIndustry: ${client?.industry || 'n/a'}\n` +
    `Target market: ${client?.targetMarket || 'n/a'}\nWebsite: ${client?.website || 'n/a'}\nNotes: ${client?.brandNotes || 'n/a'}\n</BRAND>`;

  const user = `Goal: ${goal}\nSuggested daily budget: INR ${dailyBudgetInr}. Draft the plan.`;
  const { text } = await llmChat({ system, messages: [{ role: 'user', content: user }], maxTokens: 600, temperature: 0.6 });
  const clean = String(text).replace(/```json|```/g, '').trim();
  let plan;
  try {
    plan = JSON.parse(clean);
  } catch {
    throw new Error('Could not parse the AI plan. Try rephrasing the goal.');
  }
  plan.dailyBudgetInr = Number(plan.dailyBudgetInr) || dailyBudgetInr;
  return plan;
}

// ---- 2) Upload a creative image and get an image_hash -----------------------
export async function uploadAdImageFromUrl({ adAccountId, token, imageUrl }) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch creative image (${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const form = new FormData();
  form.append('access_token', token);
  form.append('filename', new Blob([buf]), 'creative.jpg');
  const res = await fetch(`${API()}/act_${adAccountId}/adimages`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta image upload failed: ${data?.error?.message || JSON.stringify(data)}`);
  const first = data.images && Object.values(data.images)[0];
  if (!first?.hash) throw new Error('Meta did not return an image hash');
  return first.hash;
}

// ---- 3) Build the full PAUSED campaign --------------------------------------
export async function createPausedCampaign({
  token, adAccountId, pageId, plan, link, imageHash,
  objective = 'OUTCOME_TRAFFIC', optimizationGoal = 'LINK_CLICKS',
}) {
  if (!adAccountId) throw new Error('Missing Meta ad account id on the client');
  if (!pageId) throw new Error('Missing Facebook Page id (needed for the ad creative)');
  if (!link) throw new Error('Missing destination link/website');

  const t = plan.targeting || {};
  const genders = t.genders === 'male' ? [1] : t.genders === 'female' ? [2] : undefined;
  const targeting = {
    geo_locations: { countries: (t.countries && t.countries.length ? t.countries : ['IN']) },
    age_min: clamp(t.ageMin || 18, 13, 65),
    age_max: clamp(t.ageMax || 65, 13, 65),
    ...(genders ? { genders } : {}),
  };
  // Budget is in the account currency's MINOR unit (INR -> paise). Enforce a floor.
  const dailyBudgetMinor = Math.max(10000, Math.round((plan.dailyBudgetInr || 500) * 100));
  const cta = String(plan?.adCopy?.cta || 'LEARN_MORE').toUpperCase();

  // Campaign (PAUSED)
  const campaign = await graph(`act_${adAccountId}/campaigns`, {
    token, method: 'POST',
    params: { name: plan.campaignName || 'Rocky campaign', objective, status: 'PAUSED', special_ad_categories: [] },
  });

  // Ad set (PAUSED)
  const adset = await graph(`act_${adAccountId}/adsets`, {
    token, method: 'POST',
    params: {
      name: `${plan.campaignName || 'Rocky'} — Ad set`,
      campaign_id: campaign.id,
      daily_budget: dailyBudgetMinor,
      billing_event: 'IMPRESSIONS',
      optimization_goal: optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      status: 'PAUSED',
    },
  });

  // Ad creative
  const creative = await graph(`act_${adAccountId}/adcreatives`, {
    token, method: 'POST',
    params: {
      name: `${plan.campaignName || 'Rocky'} — Creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message: plan?.adCopy?.primaryText || '',
          link,
          name: plan?.adCopy?.headline || '',
          description: plan?.adCopy?.description || '',
          ...(imageHash ? { image_hash: imageHash } : {}),
          call_to_action: { type: cta, value: { link } },
        },
      },
    },
  });

  // Ad (PAUSED)
  const ad = await graph(`act_${adAccountId}/ads`, {
    token, method: 'POST',
    params: { name: `${plan.campaignName || 'Rocky'} — Ad`, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED' },
  });

  return {
    campaignId: campaign.id,
    adSetId: adset.id,
    creativeId: creative.id,
    adId: ad.id,
    status: 'PAUSED',
    adsManagerUrl: `https://www.facebook.com/adsmanager/manage/campaigns?act=${adAccountId}&selected_campaign_ids=${campaign.id}`,
  };
}

function clamp(n, lo, hi) {
  n = Number(n) || lo;
  return Math.max(lo, Math.min(hi, n));
}

// ---- Read: account insights (spend etc.) for the morning brief --------------
export async function fetchInsights({ token, adAccountId, datePreset = 'today', level = 'campaign' }) {
  const url = new URL(`${API()}/act_${adAccountId}/insights`);
  url.searchParams.set('level', level);
  url.searchParams.set('fields', 'campaign_name,spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta insights error: ${data?.error?.message || JSON.stringify(data)}`);
  const rows = data.data || [];
  const totalSpend = rows.reduce((sum, r) => sum + Number(r.spend || 0), 0);
  const leads = rows.reduce((sum, r) => sum + (Array.isArray(r.actions) ? r.actions.filter((a) => /lead/i.test(a.action_type)).reduce((x, a) => x + Number(a.value || 0), 0) : 0), 0);
  return { rows, totalSpend, leads };
}