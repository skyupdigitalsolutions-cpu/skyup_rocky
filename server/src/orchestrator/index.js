import { Client } from '../models/Client.js';
import { llmChat } from '../llm/provider.js';
import { buildSystemPrompt } from './prompts.js';
import {
  resolvePeriod,
  metricsContext,
  clientProfileContext,
  connectorStatusContext,
  documentContext,
} from './tools.js';
import { scopedClientFilter } from '../middleware/rbac.js';
import { detectScheduleIntent, extractAndSchedule, detectRescheduleIntent, extractAndReschedule, detectPublishNowIntent, findReelToPublishNow, fmtIST } from './scheduler.js';
import { ScheduledPost } from '../models/ScheduledPost.js';
import { publishScheduledPost } from '../services/reelsPublisher.js';
import { DailyBrief } from '../models/Insight.js';
import { generateMorningBrief } from '../jobs/morningBrief.js';
import { crmConfigured, answerCrmQuery, leadStats, followUpStats, attendanceToday, projectStats } from '../lib/crm.js';

// "good morning" / "brief me" / "daily insights" → spoken brief.
const MORNING_INTENT = /\b(good\s*morning|morning brief|daily brief|brief me|my brief|daily insights|today'?s insights|what'?s (my|the) brief|brief for today|catch me up)\b/i;

export async function answerQuestion({ user, question, context, history = [] }) {
  // ---- Morning brief narration (spoken-friendly) -----------------------------
  if (MORNING_INTENT.test(question)) {
    const narration = await narrateMorningBrief();
    return {
      answer: narration,
      grounding: { sources: ['morning brief'], period: 'today', toolCalls: [{ name: 'morning_brief', ok: true }], missing: [] },
      meta: { model: 'internal', usage: {} },
      action: null,
    };
  }

  // ---- Natural-language CRM queries (real data, no hallucination) ------------
  const CRM_INTENT = /\b(lead|leads|hot|warm|cold|conversion|converted|follow.?up|pipeline|crm|business summary|summary|contacted)\b/i;
  if (crmConfigured() && CRM_INTENT.test(question)) {
    try {
      const ans = await answerCrmQuery(question);
      if (ans) {
        return {
          answer: ans,
          grounding: { sources: ['CRM'], period: 'live', toolCalls: [{ name: 'crm_query', ok: true }], missing: [] },
          meta: { model: 'internal', usage: {} },
          action: null,
        };
      }
    } catch (e) {
      return {
        answer: `I couldn't read the CRM: ${e.message}`,
        grounding: { sources: [], period: '', toolCalls: [{ name: 'crm_query', ok: false, note: e.message }], missing: [] },
        meta: { model: 'internal', usage: {} },
        action: null,
      };
    }
  }

  // ---- Publish an existing reel NOW (checked before create/reschedule) -------
  if (detectPublishNowIntent(question)) {
    const found = await findReelToPublishNow({ question, user, context });
    if (found?.error) {
      return { answer: found.error, grounding: { sources: [], period: '', toolCalls: [{ name: 'publish_now', ok: false, note: found.error }], missing: [] }, meta: { model: 'internal', usage: {} }, action: null };
    }
    // Claim atomically so the scheduler can't double-publish.
    const claimed = await ScheduledPost.findOneAndUpdate(
      { _id: found.post._id, status: { $in: ['scheduled', 'retry', 'draft'] } },
      { $set: { status: 'processing' } },
      { new: true }
    );
    if (!claimed) {
      return { answer: 'That reel is already publishing or has been posted.', grounding: { sources: ['reels'], period: '', toolCalls: [{ name: 'publish_now', ok: false }], missing: [] }, meta: { model: 'internal', usage: {} }, action: null };
    }
    const published = await publishScheduledPost(claimed._id);
    const ok = published?.status === 'published';
    const answer = ok
      ? `Posting it now for ${found.clientName || 'you'} — the reel is going live${published.permalink ? '' : ' on Instagram'}.`
      : `I tried to post it now but it didn't go through: ${published?.lastError || 'unknown error'}.`;
    return {
      answer,
      grounding: { sources: ['reels publisher'], period: 'now', toolCalls: [{ name: 'publish_now', ok, note: published?.status }], missing: [] },
      meta: { model: 'scheduler', usage: {} },
      action: { type: 'publish_now', postId: String(claimed._id), status: published?.status, permalink: published?.permalink || '' },
    };
  }

  // ---- Reschedule existing reels (checked before create) ---------------------
  if (detectRescheduleIntent(question)) {
    const result = await extractAndReschedule({ question, user, context });
    if (result && result.error) {
      return { answer: result.error, grounding: { sources: [], period: '', toolCalls: [{ name: 'reschedule_reel', ok: false, note: result.error }], missing: [] }, meta: { model: 'internal', usage: {} }, action: null };
    }
    if (result && result.success) {
      const [hh, mm] = result.newTime.split(':').map((n) => parseInt(n, 10));
      const label = new Date(`2000-01-01T${result.newTime}:00`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const answer = `Done — moved ${result.moved} reel${result.moved === 1 ? '' : 's'} for ${result.clientLabel} (${result.scopeLabel}) to ${label}.`;
      return {
        answer,
        grounding: { sources: ['reels scheduler'], period: result.scopeLabel, toolCalls: [{ name: 'reschedule_reel', ok: true, note: `${result.moved} moved` }], missing: [] },
        meta: { model: 'scheduler', usage: {} },
        action: { type: 'reschedule_reel', moved: result.moved, newTime: result.newTime, scope: result.scopeLabel, clientLabel: result.clientLabel },
      };
    }
    // null → fall through
  }

  // ---- Scheduling intent (create) --------------------------------------------
  if (detectScheduleIntent(question)) {
    const result = await extractAndSchedule({ question, user, context });
    if (result && result.error) {
      return { answer: result.error, grounding: { sources: [], period: '', toolCalls: [{ name: 'schedule_reel', ok: false, note: result.error }], missing: [] }, meta: { model: 'internal', usage: {} }, action: null };
    }
    if (result && result.success) {
      const modeLabel = result.publishMode === 'approval' ? 'held for your approval' : 'set to auto-publish';
      const captionLine = result.caption ? `\n**Caption:** "${result.caption}"` : '\n**Caption:** not set — you can add one on the Reels page.';
      const answer =
        `✅ **Reel scheduled for ${result.clientName}**\n\n` +
        `**When:** ${fmtIST(result.scheduledFor)} (IST)\n**Publish mode:** ${modeLabel}` + captionLine +
        `\n\n⚠️ **One step left:** the slot is created but needs a video. Go to **Social Media → Reels** to upload the video before the scheduled time.`;
      return {
        answer,
        grounding: { sources: ['reels scheduler'], period: fmtIST(result.scheduledFor), toolCalls: [{ name: 'schedule_reel', ok: true, note: `draft post ${result.post._id}` }], missing: ['video file (upload on Reels page)'] },
        meta: { model: 'scheduler', usage: {} },
        action: { type: 'schedule_reel', postId: String(result.post._id), clientName: result.clientName, clientId: result.clientId, scheduledFor: result.scheduledFor, publishMode: result.publishMode, caption: result.caption, status: 'draft' },
      };
    }
  }

  // ---- Normal analysis flow --------------------------------------------------
  const clientId = context?.client || null;
  const period = resolvePeriod(context?.dateRange);
  const sources = [];
  const missing = [];
  const toolCalls = [];
  const contextBlocks = [];
  let clientName = null;

  // Always give Rocky the company's live state (brief + CRM) so general
  // questions like "today's priorities" have real grounding.
  const company = await companyContext();
  if (company) { contextBlocks.push(company); sources.push('today\'s brief', 'live CRM'); }

  if (clientId) {
    const client = await Client.findById(clientId).lean();
    clientName = client?.name || 'Unknown client';
    const profile = await clientProfileContext(clientId);
    if (profile) { contextBlocks.push(profile); sources.push('client profile'); }
    for (const source of ['meta', 'google_ads', 'search_console', 'ga4']) {
      const block = await metricsContext(clientId, source, period);
      if (block) { contextBlocks.push(block); sources.push(`${labelFor(source)} (${period.label})`); toolCalls.push({ name: `metrics:${source}`, ok: true, note: 'from snapshots' }); }
    }
    const docs = await documentContext(clientId, question);
    if (docs) { contextBlocks.push(docs.text); sources.push(...docs.sources); toolCalls.push({ name: 'rag:documents', ok: true, note: `${docs.sources.length} docs` }); }
    const { missing: notConnected } = await connectorStatusContext(clientId);
    for (const p of notConnected) missing.push(`${labelFor(p)} not connected`);
  } else {
    const filter = scopedClientFilter(user) || {};
    const clients = await Client.find({ status: 'active', ...filter }).select('name industry services').lean();
    if (clients.length) { contextBlocks.push(`Active clients in your scope (${clients.length}): ` + clients.map((c) => c.name).join(', ')); sources.push('client roster'); }
    else missing.push('no active clients in your scope');
  }

  const systemPrompt = buildSystemPrompt({ contextText: contextBlocks.join('\n\n'), clientName, period: period.label });
  const messages = [...history, { role: 'user', content: question }].slice(-12);
  const { text, model, usage } = await llmChat({ system: systemPrompt, messages, maxTokens: 900 });

  return {
    answer: text,
    grounding: { sources: [...new Set(sources)], period: period.label, toolCalls, missing: [...new Set(missing)] },
    meta: { model, usage },
    action: null,
  };
}

// Company-wide live context so Rocky can answer general questions ("today's
// priorities", "how are we doing") without a client selected. This is what makes
// Rocky actually know the business, not just per-client metrics.
async function companyContext() {
  const blocks = [];
  try {
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    let brief = await DailyBrief.findOne().sort({ createdAt: -1 }).lean();
    if (!brief || brief.date !== todayKey) {
      try { await generateMorningBrief(); brief = await DailyBrief.findOne().sort({ createdAt: -1 }).lean(); } catch { /* keep latest */ }
    }
    if (brief) {
      const pr = (brief.priorities || []).filter(Boolean);
      blocks.push(
        `TODAY'S BRIEF (${brief.date}):\n${brief.summary || ''}` +
        (pr.length ? `\nTODAY'S PRIORITIES:\n${pr.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : '')
      );
    }
  } catch { /* non-fatal */ }

  if (crmConfigured()) {
    try {
      const [s, fu, att, proj] = await Promise.all([
        leadStats('today'),
        followUpStats().catch(() => ({ due: 0, overdue: 0 })),
        attendanceToday().catch(() => null),
        projectStats().catch(() => ({ active: 0 })),
      ]);
      blocks.push(
        `LIVE CRM (Skyup, today): ${s.total} leads — New ${s.newLeads}, Interested ${s.interested}, Converted ${s.converted}, Not-interested ${s.notInterested}. ` +
        `Temperature: Hot ${s.hot}, Warm ${s.warm}, Cold ${s.cold}. ` +
        `Follow-ups: ${fu.due} due today, ${fu.overdue} overdue.` +
        (att ? ` Team: ${att.present}/${att.total} present.` : '') +
        ` Active projects: ${proj.active}.`
      );
    } catch { /* non-fatal */ }
  }
  return blocks.join('\n\n');
}

// Build a spoken-style morning brief (no markdown — the voice loop reads it).
async function narrateMorningBrief() {
  let brief = await DailyBrief.findOne().sort({ createdAt: -1 }).lean();
  // If today's brief isn't generated yet, make one now (best effort).
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (!brief || brief.date !== todayKey) {
    try { await generateMorningBrief(); brief = await DailyBrief.findOne().sort({ createdAt: -1 }).lean(); } catch { /* keep latest */ }
  }
  if (!brief) return `Good morning. I don't have a brief yet — once your data sources are connected and synced, I'll have your agency numbers ready each morning.`;

  const dateLabel = new Date(`${brief.date}T09:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const parts = [`Good morning. Here's your Skyup brief for ${dateLabel}.`];
  // Voice = SHORT (spend + lead outcomes). Full metrics stay on the dashboard card.
  if (brief.spokenSummary) parts.push(stripMd(brief.spokenSummary));
  else if (brief.summary) parts.push(stripMd(brief.summary));
  const pr = (brief.priorities || []).filter(Boolean);
  if (pr.length) {
    parts.push(`Top ${pr.length === 1 ? 'priority' : `${Math.min(pr.length, 3)} priorities`}:`);
    pr.slice(0, 3).forEach((p, i) => parts.push(`${i + 1}. ${stripMd(p)}.`));
  }
  const missing = brief.generatedFrom?.staleOrMissing || [];
  if (missing.length) parts.push(`Note: ${missing.length} source${missing.length === 1 ? ' is' : 's are'} not reporting yet, so some numbers may be incomplete.`);
  return parts.join(' ');
}

const stripMd = (s) => String(s).replace(/[*_`#>]/g, '').replace(/\s{2,}/g, ' ').trim();
const labelFor = (s) => ({ meta: 'Meta Ads', google_ads: 'Google Ads', search_console: 'Search Console', ga4: 'GA4' }[s] || s);