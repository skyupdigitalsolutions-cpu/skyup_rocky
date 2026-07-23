import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { retrieveForClient } from '../rag/retrieve.js';

// Resolve a date-range preset into concrete [start, end] windows plus the
// immediately-preceding comparison window of equal length.
export function resolvePeriod(dateRange = {}) {
  const end = dateRange.end ? new Date(dateRange.end) : new Date();
  let days = 7;
  if (dateRange.preset === 'last_28d') days = 28;
  else if (dateRange.preset === 'last_90d') days = 90;
  else if (dateRange.preset === 'custom' && dateRange.start) {
    days = Math.max(1, Math.round((end - new Date(dateRange.start)) / 864e5));
  }
  const start = dateRange.start ? new Date(dateRange.start) : new Date(end.getTime() - days * 864e5);
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - days * 864e5);
  return { start, end, prevStart, prevEnd, days, label: `${fmt(start)} → ${fmt(end)}` };
}

const fmt = (d) => new Date(d).toISOString().slice(0, 10);

// Aggregate normalized snapshots for one client + source across a window.
async function aggregate(clientId, source, start, end) {
  const rows = await MetricSnapshot.find({
    client: clientId,
    source,
    periodEnd: { $gte: start, $lte: end },
  }).lean();
  if (!rows.length) return null;
  const acc = { spend: 0, impressions: 0, clicks: 0, conversions: 0, sessions: 0 };
  for (const r of rows) {
    for (const k of Object.keys(acc)) acc[k] += Number(r.metrics?.[k] || 0);
  }
  acc.ctr = acc.impressions ? (acc.clicks / acc.impressions) * 100 : 0;
  acc.cpc = acc.clicks ? acc.spend / acc.clicks : 0;
  acc.costPerConv = acc.conversions ? acc.spend / acc.conversions : 0;
  acc.rows = rows.length;
  return acc;
}

const pct = (curr, prev) => (prev ? ((curr - prev) / prev) * 100 : null);

// Build a compact, human-readable comparison line block for a source.
export async function metricsContext(clientId, source, period) {
  const curr = await aggregate(clientId, source, period.start, period.end);
  if (!curr) return null;
  const prev = await aggregate(clientId, source, period.prevStart, period.prevEnd);

  const label = { meta: 'Meta Ads', google_ads: 'Google Ads', ga4: 'GA4', search_console: 'Search Console' }[source];
  const lines = [`${label} (${period.label}, current vs prior ${period.days}d):`];
  const show = (name, val, prevVal, unit = '', money = false) => {
    const v = money ? `₹${Math.round(val).toLocaleString('en-IN')}` : `${round(val)}${unit}`;
    const change = prev ? pct(val, prevVal) : null;
    const delta = change == null ? '' : ` (${change >= 0 ? '+' : ''}${round(change)}% vs prior)`;
    lines.push(`- ${name}: ${v}${delta}`);
  };
  if (source === 'meta' || source === 'google_ads') {
    show('Spend', curr.spend, prev?.spend, '', true);
    show('Impressions', curr.impressions, prev?.impressions);
    show('Clicks', curr.clicks, prev?.clicks);
    show('CTR', curr.ctr, prev?.ctr, '%');
    show('CPC', curr.cpc, prev?.cpc, '', true);
    show('Conversions', curr.conversions, prev?.conversions);
    if (curr.conversions) show('Cost / conversion', curr.costPerConv, prev?.costPerConv, '', true);
  } else if (source === 'ga4') {
    show('Sessions', curr.sessions, prev?.sessions);
    show('Conversions', curr.conversions, prev?.conversions);
  } else if (source === 'search_console') {
    show('Clicks', curr.clicks, prev?.clicks);
    show('Impressions', curr.impressions, prev?.impressions);
    show('CTR', curr.ctr, prev?.ctr, '%');
  }
  return lines.join('\n');
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Client profile as context lines.
export async function clientProfileContext(clientId) {
  const c = await Client.findById(clientId).lean();
  if (!c) return null;
  const svc = (c.services || []).map((s) => `${s.name} (${s.status})`).join(', ') || 'none listed';
  return [
    `Client profile: ${c.name}`,
    `- Industry: ${c.industry || 'n/a'}`,
    `- Status: ${c.status}`,
    `- Services: ${svc}`,
    c.goals ? `- Goals: ${c.goals}` : null,
    c.targetMarket ? `- Target market: ${c.targetMarket}` : null,
    c.brandNotes ? `- Brand notes: ${c.brandNotes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

// Which connectors are configured/connected for a client (for "what's missing").
export async function connectorStatusContext(clientId) {
  const integrations = await Integration.find({ client: clientId }).lean();
  const byProvider = Object.fromEntries(integrations.map((i) => [i.provider, i]));
  const providers = ['meta', 'google_ads', 'search_console', 'ga4'];
  const connected = providers.filter((p) => byProvider[p]?.status === 'connected');
  const missing = providers.filter((p) => byProvider[p]?.status !== 'connected');
  return { connected, missing };
}

// RAG document context.
export async function documentContext(clientId, query) {
  const hits = await retrieveForClient(clientId, query, { k: 5 });
  if (!hits.length) return null;
  const lines = ['Relevant client documents:'];
  for (const h of hits) {
    lines.push(`- From "${h.documentTitle}": ${h.text.replace(/\s+/g, ' ').slice(0, 320)}`);
  }
  return { text: lines.join('\n'), sources: [...new Set(hits.map((h) => `doc:${h.documentTitle}`))] };
}
