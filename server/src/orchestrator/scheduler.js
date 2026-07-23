import { Client } from '../models/Client.js';
import { ScheduledPost } from '../models/ScheduledPost.js';
import { llmChat } from '../llm/provider.js';
import { canAccessClient, scopedClientFilter } from '../middleware/rbac.js';
import { logger } from '../lib/logger.js';

// ---- Intent detection (fast, no LLM) ----------------------------------------
const SCHEDULE_VERBS = /\b(schedule|post|publish|upload|queue)\b/i;
const SOCIAL_NOUNS = /\b(reel|reels|instagram|insta|story|stories|content|video|post)\b/i;
const TIME_HINTS = /\b(at \d|tomorrow|tonight|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d+\s*(am|pm))\b/i;

const RESCHEDULE_VERBS = /\b(reschedule|re-schedule|change|move|shift|update|push|postpone|delay|set)\b/i;
const RESCHEDULE_NOUNS = /\b(reel|reels|schedule|scheduling|timing|timings|time|slot|posting|post)\b/i;

export function detectScheduleIntent(text) {
  return SCHEDULE_VERBS.test(text) && (SOCIAL_NOUNS.test(text) || TIME_HINTS.test(text));
}

// "change the reel timing today to 8pm", "shift this week's reels to 7pm", etc.
export function detectRescheduleIntent(text) {
  return RESCHEDULE_VERBS.test(text) && RESCHEDULE_NOUNS.test(text) && /\b(\d{1,2}(:\d{2})?\s*(am|pm)?|\d{1,2}:\d{2})\b/i.test(text);
}

// "post it now", "publish the reel now", "go live now"
const PUBLISH_NOW = /\b(post|publish|share|go live)\b[\s\S]{0,30}\bnow\b|\bpublish it\b|\bpost it now\b/i;
export function detectPublishNowIntent(text) {
  return PUBLISH_NOW.test(text) && /\b(reel|reels|it|post|video|instagram|insta|this)\b/i.test(text);
}

// Find the soonest publishable reel (WITH a video) in the user's scope so it can
// be published immediately.
export async function findReelToPublishNow({ question, user, context }) {
  const filter = user.role === 'admin' ? {} : { _id: { $in: user.assignedClients || [] } };
  const clients = await Client.find({ status: 'active', ...filter }).select('_id name').lean();
  if (!clients.length) return { error: 'No active clients in your scope.' };

  const q = (question || '').toLowerCase();
  const mentioned = clients.find((c) => c.name && q.includes(c.name.toLowerCase().split(' ')[0]));
  let clientIds;
  if (mentioned) clientIds = [mentioned._id];
  else if (context?.client) clientIds = [context.client];
  else clientIds = clients.map((c) => c._id);

  const post = await ScheduledPost.findOne({
    client: { $in: clientIds },
    status: { $in: ['scheduled', 'retry', 'draft'] },
    'media.videoUrl': { $nin: ['', null] },
  }).sort({ scheduledFor: 1 });

  if (!post) return { error: "I couldn't find a scheduled reel with a video ready to post right now. Upload one first, then say \"post it now\"." };
  if (!canAccessClient(user, post.client)) return { error: "That reel isn't in your scope." };
  const client = clients.find((c) => String(c._id) === String(post.client));
  return { post, clientName: client?.name || '' };
}

// ---- Parameter extraction + post creation -----------------------------------
export async function extractAndSchedule({ question, user, context }) {
  const filter = user.role === 'admin' ? {} : { _id: { $in: user.assignedClients || [] } };
  const clients = await Client.find({ status: 'active', ...filter }).select('_id name').lean();
  if (!clients.length) return { error: 'No active clients in your scope.' };

  const nowIST = new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Kolkata', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const system =
    `You are a scheduling assistant for an Instagram Reels scheduler. ` +
    `Extract scheduling details from the user's message and return ONLY valid JSON — ` +
    `no markdown fences, no explanation, just the JSON object.\n\n` +
    `Schema:\n{\n  "isScheduleRequest": true | false,\n  "clientName": "<name from the list below, or null>",\n` +
    `  "scheduledFor": "<ISO 8601 datetime in Asia/Kolkata timezone, or null>",\n  "caption": "<caption text if mentioned, or null>",\n` +
    `  "publishMode": "auto" | "approval",\n  "confidence": "high" | "medium" | "low"\n}\n\n` +
    `Available clients: ${clients.map((c) => c.name).join(', ')}\n` +
    `Current date/time (Asia/Kolkata): ${nowIST}\n\n` +
    `Rules:\n- Resolve relative times ("tomorrow 6pm") to exact ISO datetimes.\n` +
    `- Match partial client names.\n- "hold for approval" => publishMode="approval"; else "auto".\n` +
    `- If not a reel scheduling request, isScheduleRequest=false.\n- confidence=low if unsure about time or client.`;

  let params;
  try {
    const { text } = await llmChat({ system, messages: [{ role: 'user', content: question }], maxTokens: 300, temperature: 0 });
    params = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.warn({ err: err.message }, '[scheduler] param extraction failed');
    return null;
  }

  if (!params.isScheduleRequest) return null;
  if (params.confidence === 'low') {
    return { error: `I'm not confident I understood the schedule details. Please specify: client, exact date + time (e.g. "tomorrow at 6pm"), and optionally a caption.` };
  }
  if (!params.scheduledFor) return { error: `Please include a date and time — e.g. "tomorrow at 6pm IST".` };

  const byName = (name) =>
    clients.find((c) =>
      c.name.toLowerCase() === (name || '').toLowerCase() ||
      c.name.toLowerCase().includes((name || '').toLowerCase()) ||
      (name || '').toLowerCase().includes(c.name.toLowerCase())
    );
  const clientMatch = byName(params.clientName) || (context?.client ? clients.find((c) => String(c._id) === context.client) : null);
  if (!clientMatch) return { error: `I couldn't match "${params.clientName}" to a client in your scope. Available: ${clients.map((c) => c.name).join(', ')}.` };
  if (!canAccessClient(user, clientMatch._id)) return { error: `You don't have access to ${clientMatch.name}.` };

  const scheduledFor = new Date(params.scheduledFor);
  if (isNaN(scheduledFor.getTime())) return { error: `I couldn't parse "${params.scheduledFor}" as a valid datetime.` };
  if (scheduledFor < new Date()) return { error: `That time (${fmtIST(scheduledFor)}) is in the past. Please choose a future time.` };

  const post = await ScheduledPost.create({
    client: clientMatch._id,
    caption: params.caption || '',
    scheduledFor,
    timezone: 'Asia/Kolkata',
    publishMode: params.publishMode || 'auto',
    status: 'draft',
    media: { videoUrl: '', publicId: '', thumbnailUrl: '', durationSec: 0, sizeBytes: 0 },
    createdBy: user._id,
  });
  logger.info(`[scheduler] created draft post ${post._id} for ${clientMatch.name} at ${fmtIST(scheduledFor)}`);

  return {
    success: true, post: post.toObject(), clientName: clientMatch.name, clientId: String(clientMatch._id),
    scheduledFor, publishMode: params.publishMode || 'auto', caption: params.caption || null,
  };
}

// ---- Reschedule existing reels ----------------------------------------------
export async function extractAndReschedule({ question, user, context }) {
  const filter = user.role === 'admin' ? {} : { _id: { $in: user.assignedClients || [] } };
  const clients = await Client.find({ status: 'active', ...filter }).select('_id name').lean();
  if (!clients.length) return { error: 'No active clients in your scope.' };

  const nowIST = new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Kolkata', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const system =
    `You reschedule already-scheduled Instagram reels. Return ONLY valid JSON, no fences.\n\n` +
    `Schema:\n{\n  "isReschedule": true|false,\n  "clientName": "<name or null>",\n` +
    `  "scope": "today" | "tomorrow" | "week" | "range" | "all_upcoming" | "single",\n` +
    `  "dateFrom": "YYYY-MM-DD" | null,\n  "dateTo": "YYYY-MM-DD" | null,\n` +
    `  "newTime": "HH:MM" (24h) | null,\n  "confidence": "high"|"medium"|"low"\n}\n\n` +
    `Available clients: ${clients.map((c) => c.name).join(', ')}\n` +
    `Current date/time (Asia/Kolkata): ${nowIST}\n\n` +
    `Rules:\n- "today"/"only today" => scope=today. "this week" => week. "from X to Y" => range with dateFrom/dateTo.\n` +
    `- newTime is the new time-of-day to apply (e.g. "8pm" => "20:00").\n` +
    `- If no client mentioned, leave clientName null.\n- confidence=low if the new time is unclear.`;

  let p;
  try {
    const { text } = await llmChat({ system, messages: [{ role: 'user', content: question }], maxTokens: 250, temperature: 0 });
    p = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.warn({ err: err.message }, '[scheduler] reschedule extraction failed');
    return null;
  }
  if (!p.isReschedule) return null;
  if (!p.newTime || !/^\d{1,2}:\d{2}$/.test(p.newTime)) return { error: `What time should I move them to? e.g. "change today's reel to 8pm".` };
  if (p.confidence === 'low') return { error: `I'm not sure which reels or what new time. Try: "move this week's reels to 7pm".` };

  // Resolve client scope.
  const byName = (name) => clients.find((c) =>
    c.name.toLowerCase() === (name || '').toLowerCase() ||
    c.name.toLowerCase().includes((name || '').toLowerCase()) ||
    (name || '').toLowerCase().includes(c.name.toLowerCase()));
  let clientIds;
  let clientLabel;
  const matched = byName(p.clientName);
  if (matched) { clientIds = [matched._id]; clientLabel = matched.name; }
  else if (context?.client) { const c = clients.find((x) => String(x._id) === context.client); clientIds = c ? [c._id] : clients.map((c) => c._id); clientLabel = c?.name || 'all clients'; }
  else { clientIds = clients.map((c) => c._id); clientLabel = 'all clients'; }

  // Resolve date range in IST days.
  const today = istDayKey(new Date());
  let from = today, to = today, scopeLabel = 'today';
  if (p.scope === 'tomorrow') { from = to = addDaysKey(today, 1); scopeLabel = 'tomorrow'; }
  else if (p.scope === 'week') { from = today; to = addDaysKey(today, 6); scopeLabel = 'this week'; }
  else if (p.scope === 'all_upcoming') { from = today; to = addDaysKey(today, 365); scopeLabel = 'all upcoming'; }
  else if (p.scope === 'range') {
    if (!p.dateFrom || !p.dateTo) return { error: 'Please give the start and end dates for the range.' };
    from = p.dateFrom; to = p.dateTo; scopeLabel = `${from} to ${to}`;
  } else if (p.scope === 'single' && p.dateFrom) { from = to = p.dateFrom; scopeLabel = p.dateFrom; }

  const rangeStart = new Date(`${from}T00:00:00+05:30`);
  const rangeEnd = new Date(`${to}T23:59:59+05:30`);

  const posts = await ScheduledPost.find({
    client: { $in: clientIds },
    status: { $in: ['scheduled', 'draft', 'retry'] },
    scheduledFor: { $gte: rangeStart, $lte: rangeEnd },
  });

  if (!posts.length) return { error: `No upcoming reels found for ${clientLabel} in ${scopeLabel}.` };

  const [nh, nm] = p.newTime.split(':').map((n) => parseInt(n, 10));
  let moved = 0;
  for (const post of posts) {
    const dayKey = istDayKey(post.scheduledFor);
    const nextTime = new Date(`${dayKey}T${pad(nh)}:${pad(nm)}:00+05:30`);
    post.scheduledFor = nextTime;
    if (post.status === 'retry') post.status = 'scheduled';
    await post.save();
    moved++;
  }

  return { success: true, moved, newTime: p.newTime, scopeLabel, clientLabel };
}

// ---- helpers ----------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const istDayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function addDaysKey(dayKey, n) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtIST(d) {
  return new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}