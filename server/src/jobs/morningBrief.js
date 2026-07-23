import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { Insight, DailyBrief } from '../models/Insight.js';
import { llmChat } from '../llm/provider.js';
import { resolvePeriod, metricsContext } from '../orchestrator/tools.js';
import { decryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { crmConfigured, leadStats } from '../lib/crm.js';
import { fetchInsights } from '../services/metaAdsBuilder.js';

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// Generate the daily brief. The headline focus is Skyup itself: today's ad
// SPEND (Meta) + CRM lead OUTCOMES (converted / interested / warm / cold). Voice
// hears a SHORT line; the full metrics live in the on-screen report.
export async function generateMorningBrief() {
  const clients = await Client.find({ status: 'active' }).lean();
  const period = resolvePeriod({ preset: 'last_7d' });

  const items = [];
  const staleOrMissing = new Set();
  const connectorsAvailable = new Set();

  // ---- existing cross-client attention scan (kept) --------------------------
  for (const client of clients) {
    const integrations = await Integration.find({ client: client._id }).lean();
    const connected = integrations.filter((i) => i.status === 'connected').map((i) => i.provider);
    if (!connected.length) { staleOrMissing.add(`${client.name}: no connected sources`); continue; }
    for (const source of connected) {
      connectorsAvailable.add(source);
      const block = await metricsContext(client._id, source, period);
      if (!block) { staleOrMissing.add(`${client.name}/${source}: no recent data`); continue; }
      const severity = severityFromBlock(block);
      if (severity !== 'info') {
        const headline = firstConcern(block) || `${labelFor(source)} movement needs review`;
        items.push({ client: client._id, clientName: client.name, severity, headline, source: labelFor(source) });
        await Insight.create({ client: client._id, kind: 'alert', severity, source, title: `${client.name}: ${headline}`, body: block, evidence: block.split('\n').slice(1), period: period.label });
      }
    }
  }

  // ---- Skyup daily: SPEND + CRM lead outcomes -------------------------------
  const detailLines = [];
  const spokenBits = [];

  // (a) Today's ad spend from the connected Meta account.
  let spendReady = false;
  try {
    const skyup = clients.find((c) => /skyup/i.test(c.name));
    const adAccountId = skyup?.accountRefs?.metaAdAccountId;
    if (skyup && adAccountId) {
      const integ = await Integration.findOne({ client: skyup._id, provider: 'meta', status: 'connected' }).select('+credentials');
      const enc = integ?.credentials?.get?.('accessToken');
      const token = enc ? decryptSecret(enc) : null;
      if (token) {
        const { rows, totalSpend, leads } = await fetchInsights({ token, adAccountId, datePreset: 'today', level: 'campaign' });
        spendReady = true;
        detailLines.push(`SPEND TODAY — ${inr(totalSpend)} across ${rows.length} campaign(s):`);
        rows
          .slice()
          .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
          .forEach((r) => detailLines.push(`  • ${r.campaign_name || 'Campaign'}: ${inr(r.spend)} · ${r.clicks || 0} clicks · CTR ${Number(r.ctr || 0).toFixed(2)}%`));
        spokenBits.push(`Skyup spent ${inr(totalSpend)} today${rows.length ? ` across ${rows.length} campaign${rows.length > 1 ? 's' : ''}` : ''}${leads ? `, driving ${leads} ad lead${leads > 1 ? 's' : ''}` : ''}.`);
      } else staleOrMissing.add('Skyup Meta Ads not connected (no spend)');
    } else staleOrMissing.add('Skyup ad account id not set (no spend)');
  } catch (e) {
    logger.warn({ err: e.message }, '[brief] spend fetch failed');
    staleOrMissing.add(`Meta spend unavailable: ${e.message}`);
  }

  // (b) CRM lead outcomes for Skyup today.
  if (crmConfigured()) {
    try {
      const s = await leadStats('today');
      detailLines.push('');
      detailLines.push(`LEADS TODAY — ${s.total} total:`);
      detailLines.push(`  • Converted: ${s.converted}   • Interested: ${s.interested}   • New: ${s.newLeads}   • Not interested: ${s.notInterested}`);
      detailLines.push(`  • Temperature — Hot: ${s.hot}   Warm: ${s.warm}   Cold: ${s.cold}`);
      spokenBits.push(
        `${s.total} new lead${s.total === 1 ? '' : 's'} today: ${s.converted} converted, ${s.interested} interested, ${s.warm} warm and ${s.cold} cold.`
      );
    } catch (e) {
      logger.warn({ err: e.message }, '[brief] CRM lead stats failed');
      staleOrMissing.add(`CRM leads unavailable: ${e.message}`);
    }
  } else {
    staleOrMissing.add('CRM not connected (set CRM_MONGO_URI)');
  }

  // ---- assemble ------------------------------------------------------------
  const date = new Date().toLocaleDateString('en-CA', { timeZone: env.BRIEF_TIMEZONE });
  const priorities = items.sort((a, b) => rank(b.severity) - rank(a.severity)).slice(0, 5).map((i) => `${i.clientName}: ${i.headline}`);

  const spokenSummary =
    spokenBits.length
      ? spokenBits.join(' ')
      : `No Skyup spend or lead data is available yet today — connect the Meta ad account and the CRM to see it here.`;

  // Detailed on-screen report (kept short-ish but complete).
  let summary = detailLines.join('\n').trim();
  if (!summary) summary = spokenSummary;
  // A brief AI paragraph on the flagged accounts, appended under the numbers.
  if (items.length) {
    try {
      const evidence = items.map((i) => `${i.clientName}: ${i.headline} (${i.source})`).join('\n');
      const { text } = await llmChat({
        system: `You are Rocky. In 2-3 sentences, note which accounts need attention today and why. Use ONLY this list, no invented numbers:\n${evidence}`,
        messages: [{ role: 'user', content: 'Write the attention note.' }],
        maxTokens: 180,
      });
      if (text) summary += `\n\nATTENTION\n${text.trim()}`;
    } catch { /* numbers already present */ }
  }

  const brief = await DailyBrief.findOneAndUpdate(
    { date },
    {
      date,
      summary,
      spokenSummary,
      priorities,
      items,
      generatedFrom: { clientsCount: clients.length, connectorsAvailable: [...connectorsAvailable], staleOrMissing: [...staleOrMissing] },
    },
    { upsert: true, new: true }
  );

  logger.info(`[brief] generated for ${date}: spend=${spendReady}, crm=${crmConfigured()}, attention=${items.length}`);
  return brief;
}

function severityFromBlock(block) {
  const deltas = [...block.matchAll(/\(([-+]?\d+(?:\.\d+)?)% vs prior\)/g)].map((m) => Number(m[1]));
  const worst = Math.min(0, ...deltas);
  const best = Math.max(0, ...deltas);
  if (worst <= -40) return 'critical';
  if (worst <= -20 || best >= 60) return 'attention';
  return 'info';
}
function firstConcern(block) {
  const line = block.split('\n').find((l) => /\(-\d/.test(l));
  return line ? line.replace(/^-\s*/, '').trim() : null;
}
const rank = (s) => ({ critical: 3, attention: 2, info: 1 }[s] || 0);
const labelFor = (s) => ({ meta: 'Meta Ads', google_ads: 'Google Ads', search_console: 'Search Console', ga4: 'GA4' }[s] || s);