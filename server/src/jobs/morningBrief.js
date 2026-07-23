import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { Insight, DailyBrief } from '../models/Insight.js';
import { llmChat } from '../llm/provider.js';
import { resolvePeriod, metricsContext } from '../orchestrator/tools.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

// Generate the cross-client executive brief. Flags accounts needing attention
// based ONLY on available connected data; records which connectors were
// stale/missing rather than inventing numbers (PRD 3.5 / 9).
export async function generateMorningBrief() {
  const clients = await Client.find({ status: 'active' }).lean();
  const period = resolvePeriod({ preset: 'last_7d' });

  const items = [];
  const evidenceForLLM = [];
  const staleOrMissing = new Set();
  const connectorsAvailable = new Set();

  for (const client of clients) {
    const integrations = await Integration.find({ client: client._id }).lean();
    const connected = integrations.filter((i) => i.status === 'connected').map((i) => i.provider);
    if (!connected.length) {
      staleOrMissing.add(`${client.name}: no connected sources`);
      continue;
    }

    for (const source of connected) {
      connectorsAvailable.add(source);
      const block = await metricsContext(client._id, source, period);
      if (!block) {
        staleOrMissing.add(`${client.name}/${source}: no recent data`);
        continue;
      }
      evidenceForLLM.push(`### ${client.name}\n${block}`);

      // Deterministic attention heuristic: large negative movement on a key line.
      const severity = severityFromBlock(block);
      if (severity !== 'info') {
        const headline = firstConcern(block) || `${labelFor(source)} movement needs review`;
        items.push({
          client: client._id,
          clientName: client.name,
          severity,
          headline,
          source: labelFor(source),
        });
        await Insight.create({
          client: client._id,
          kind: 'alert',
          severity,
          source,
          title: `${client.name}: ${headline}`,
          body: block,
          evidence: block.split('\n').slice(1),
          period: period.label,
        });
      }
    }
  }

  const summary = await summarize(evidenceForLLM, items, period.label);

  const date = new Date().toLocaleDateString('en-CA', { timeZone: env.BRIEF_TIMEZONE });
  const priorities = items
    .sort((a, b) => rank(b.severity) - rank(a.severity))
    .slice(0, 5)
    .map((i) => `${i.clientName}: ${i.headline}`);

  const brief = await DailyBrief.findOneAndUpdate(
    { date },
    {
      date,
      summary,
      priorities,
      items,
      generatedFrom: {
        clientsCount: clients.length,
        connectorsAvailable: [...connectorsAvailable],
        staleOrMissing: [...staleOrMissing],
      },
    },
    { upsert: true, new: true }
  );

  logger.info(`[brief] generated for ${date}: ${items.length} attention items`);
  return brief;
}

async function summarize(evidence, items, periodLabel) {
  if (!evidence.length) {
    return `No connected performance data was available for the ${periodLabel} window. Connect Meta/Google Ads, Search Console, or GA4 for at least one client to populate the brief.`;
  }
  const system =
    `You are Rocky. Write a short agency morning brief for the Skyup team. ` +
    `Use ONLY the data below. Separate observations from recommendations. Do not invent numbers. ` +
    `Be concise (max ~150 words).\n\n<CONTEXT>\n${evidence.join('\n\n')}\n</CONTEXT>`;
  const user =
    `Summarize which of the ${items.length} flagged accounts need attention and why, ` +
    `then give the top 3 priorities for today.`;
  try {
    const { text } = await llmChat({ system, messages: [{ role: 'user', content: user }], maxTokens: 500 });
    return text;
  } catch (err) {
    logger.warn({ err: err.message }, '[brief] LLM summary failed; using deterministic fallback');
    return items.length
      ? `${items.length} account(s) flagged for review this ${periodLabel}. See priorities below.`
      : `All connected accounts look steady for the ${periodLabel} window.`;
  }
}

// Parse the "(+/-x% vs prior)" deltas out of a metrics block to gauge severity.
function severityFromBlock(block) {
  const deltas = [...block.matchAll(/\(([-+]?\d+(?:\.\d+)?)% vs prior\)/g)].map((m) => Number(m[1]));
  const worst = Math.min(0, ...deltas);
  const best = Math.max(0, ...deltas);
  if (worst <= -40) return 'critical';
  if (worst <= -20 || best >= 60) return 'attention';
  return 'info';
}

function firstConcern(block) {
  const line = block
    .split('\n')
    .find((l) => /\(-\d/.test(l));
  return line ? line.replace(/^-\s*/, '').trim() : null;
}

const rank = (s) => ({ critical: 3, attention: 2, info: 1 }[s] || 0);
const labelFor = (s) =>
  ({ meta: 'Meta Ads', google_ads: 'Google Ads', search_console: 'Search Console', ga4: 'GA4' }[s] || s);
