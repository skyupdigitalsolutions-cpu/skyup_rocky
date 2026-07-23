import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '../models/Client.js';
import { ScheduledPost } from '../models/ScheduledPost.js';
import { getSetting } from '../models/Setting.js';
import { uploadLocalVideo, cloudinaryConfigured } from '../lib/cloudinary.js';
import { captionFromVideo, visionConfigured, capHashtags } from '../services/visionCaption.js';
import { llmChat } from '../llm/provider.js';
import { logActivity } from '../models/Activity.js';
import { logger } from '../lib/logger.js';

// ============================================================================
// Watch-folder automation (config from the UI, stored in the DB).
//
// SIMPLE MODE (recommended): just name files by number —
//     1.mp4  2.mp4  3.mp4 …
// Each is auto-slotted to the next FREE daily slot (default 6:00 PM IST) for
// the default client (default: Skyup), in number order. Drop 7 files → they
// fill the next 7 evenings. No dates or client names in the filename.
//
// ADVANCED MODE (still supported): name a file with an explicit target —
//     <client>__<YYYY-MM-DD>__<HHMM>.mp4   e.g. acme__2026-07-25__1800.mp4
//
// Optional caption sidecar: <same-name>.txt. If absent, Rocky auto-captions by
// LOOKING at the video (vision), falling back to brand-notes text.
//
// The server polls the folder; for each new, fully-copied video it uploads to
// Cloudinary and creates a SCHEDULED auto-publish reel, then moves the file to
// _processed/ (or _failed/). The reels cron publishes it at the scheduled time.
// ============================================================================

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
const STABLE_MS = 8000; // file size must hold steady this long before we touch it
const BASE_TICK_MS = 5000;

const seen = new Map(); // filename -> { size, since }
let busy = false;
let loopHandle = null;
let lastScanTickAt = 0;
let status = { lastScanAt: null, lastError: '', lastResult: { scheduled: 0, failed: 0 }, currentDir: '' };

// DB config overrides .env defaults. Empty dir / disabled => watcher idles.
export async function resolveConfig() {
  const envDefaults = {
    enabled: String(process.env.REELS_WATCH_ENABLED || '').toLowerCase() === 'true',
    dir: process.env.REELS_WATCH_DIR || '',
    intervalSec: Number(process.env.REELS_WATCH_INTERVAL_SEC || 20),
    defaultClient: process.env.REELS_DEFAULT_CLIENT || 'Skyup',
    dailyTime: process.env.REELS_DAILY_TIME || '18:00',
  };
  const saved = await getSetting('reelsWatch', null);
  if (!saved) return envDefaults;
  return {
    enabled: saved.enabled ?? envDefaults.enabled,
    dir: saved.dir ?? envDefaults.dir,
    intervalSec: saved.intervalSec ?? envDefaults.intervalSec,
    defaultClient: saved.defaultClient || envDefaults.defaultClient,
    dailyTime: saved.dailyTime || envDefaults.dailyTime,
  };
}

export function getWatchStatus() {
  return { ...status, cloudinaryReady: cloudinaryConfigured(), running: Boolean(loopHandle) };
}

export function startFolderWatcher() {
  if (loopHandle) return;
  loopHandle = setInterval(() => loopTick().catch((err) => logger.error({ err }, '[watch] loop failed')), BASE_TICK_MS);
  logger.info('[watch] folder watcher loop started (configure it in the app under Social Media, or via .env)');
}

async function loopTick() {
  let cfg;
  try {
    cfg = await resolveConfig();
  } catch {
    return;
  }
  if (!cfg.dir) return; // always-on: watch whenever a folder is configured
  const now = Date.now();
  if (now - lastScanTickAt < Math.max(5, cfg.intervalSec) * 1000) return;
  lastScanTickAt = now;
  await scan(cfg);
}

// Manual trigger from the UI.
export async function scanNow() {
  const cfg = await resolveConfig();
  if (!cfg.dir) throw new Error('No watch folder path is set.');
  return scan(cfg);
}

async function scan(cfg) {
  const dir = cfg.dir;
  if (busy) return status.lastResult;
  busy = true;
  status.currentDir = dir;
  status.lastError = '';
  let scheduled = 0;
  let failed = 0;
  try {
    await ensureDirs(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });

    // Only video files, processed in NUMERIC order so 1.mp4 lands before 2.mp4.
    const vids = entries
      .filter((e) => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
      .sort((a, b) => seqNum(a.name) - seqNum(b.name) || a.name.localeCompare(b.name));

    for (const e of vids) {
      const full = path.join(dir, e.name);
      const stat = await fs.stat(full);
      const prev = seen.get(e.name);
      if (!prev || prev.size !== stat.size) {
        seen.set(e.name, { size: stat.size, since: Date.now() });
        continue; // still copying — wait for it to stabilize
      }
      if (Date.now() - prev.since < STABLE_MS) continue;

      seen.delete(e.name);
      const ok = await processFile(dir, e.name, cfg);
      if (ok) scheduled++;
      else failed++;
    }
    status.lastScanAt = new Date();
    status.lastResult = { scheduled, failed };
  } catch (err) {
    status.lastError = err.message || String(err);
    logger.error({ err }, '[watch] scan failed');
  } finally {
    busy = false;
  }
  return status.lastResult;
}

const seqNum = (name) => {
  const m = name.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
};

async function ensureDirs(dir) {
  await fs.mkdir(path.join(dir, '_processed'), { recursive: true });
  await fs.mkdir(path.join(dir, '_failed'), { recursive: true });
}

async function processFile(dir, filename, cfg) {
  const full = path.join(dir, filename);
  const base = filename.replace(/\.[^.]+$/, '');
  const legacy = base.includes('__');
  logger.info(`[watch] processing ${filename}`);

  let clientName;
  let scheduledFor = null;
  try {
    if (legacy) {
      ({ clientName, scheduledFor } = parseLegacyName(base));
    } else {
      clientName = cfg.defaultClient; // simple mode: fixed client
    }

    const clients = await Client.find({}).select('_id name accountRefs brandNotes industry targetMarket').lean();
    const client = matchClient(clients, clientName);
    if (!client) throw new Error(`No client matches "${clientName}". Available: ${clients.map((c) => c.name).join(', ')}`);

    // Simple mode: assign the next free daily slot (e.g. 6 PM) for this client.
    if (!legacy) scheduledFor = await nextFreeDailySlot(client._id, cfg.dailyTime);

    await logActivity({
      client: client._id, clientName: client.name, kind: 'upload', state: 'running',
      title: `Uploading "${filename}"`, detail: 'Sending video to storage…',
    });

    const media = await uploadLocalVideo(full, {});

    await logActivity({
      client: client._id, clientName: client.name, kind: 'upload', state: 'success',
      title: `Uploaded "${filename}"`, detail: `${media.durationSec}s · ${(media.sizeBytes / 1e6).toFixed(1)} MB`,
      thumbnailUrl: media.thumbnailUrl,
    });

    // Caption: sidecar > vision (looks at the video) > brand-notes text.
    let caption = await readSidecar(dir, base);
    let captionSource = caption ? 'sidecar file' : '';
    let visionErr = '';
    if (caption) caption = capHashtags(caption);
    if (!caption) {
      await logActivity({ client: client._id, clientName: client.name, kind: 'caption', state: 'running', title: 'Writing caption…', detail: 'Rocky is watching the video' });
      if (visionConfigured()) {
        try {
          caption = await captionFromVideo({ videoUrl: media.videoUrl, client });
          if (caption) captionSource = 'vision';
        } catch (e) {
          visionErr = e.message || String(e);
          logger.warn(`[watch] vision caption failed: ${visionErr}`);
        }
      }
      if (!caption) { caption = capHashtags(await autoCaptionText(client).catch(() => '')); captionSource = caption ? 'brand notes' : ''; }
      await logActivity({
        client: client._id, clientName: client.name, kind: 'caption', state: caption ? 'success' : 'error',
        title: caption ? `Caption ready (${captionSource})` : 'No caption generated',
        detail: visionErr && captionSource !== 'vision' ? `vision unavailable: ${visionErr.slice(0, 140)} — used ${captionSource || 'nothing'}` : (caption ? (caption.split('\n')[0].slice(0, 90)) : ''),
      });
    }

    const post = await ScheduledPost.create({
      client: client._id,
      platform: 'instagram',
      mediaType: 'reel',
      caption: caption || '',
      media,
      scheduledFor,
      timezone: 'Asia/Kolkata',
      publishMode: 'auto',
      status: 'scheduled',
    });

    await logActivity({
      client: client._id, clientName: client.name, kind: 'schedule', state: 'success', post: post._id,
      title: `Reel scheduled — ${fmtIST(scheduledFor)}`, detail: `"${(caption || '').split('\n')[0].slice(0, 80)}"`,
      thumbnailUrl: media.thumbnailUrl,
    });

    await moveTo(dir, filename, '_processed');
    await moveSidecar(dir, base, '_processed');
    logger.info(`[watch] scheduled reel for ${client.name} at ${scheduledFor.toISOString()} (post ${post._id})`);
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, `[watch] failed: ${filename}`);
    await logActivity({ kind: 'failed', state: 'error', title: `Couldn't process "${filename}"`, detail: err.message?.slice(0, 200) || 'error' });
    await moveTo(dir, filename, '_failed').catch(() => {});
    await fs.writeFile(path.join(dir, '_failed', `${base}.error.txt`), String(err.message || err)).catch(() => {});
    return false;
  }
}

// ---- daily slotting (simple mode) -------------------------------------------
// Finds the next FUTURE day at cfg.dailyTime (IST) that has no reel yet for
// this client, so numbered files fill consecutive evenings.
async function nextFreeDailySlot(clientId, dailyTime) {
  const [hh, mm] = String(dailyTime || '18:00').split(':').map((n) => parseInt(n, 10));
  const taken = await ScheduledPost.find({
    client: clientId,
    platform: 'instagram',
    status: { $in: ['scheduled', 'processing', 'retry', 'draft'] },
  }).select('scheduledFor').lean();
  const takenDays = new Set(taken.map((p) => istDayKey(new Date(p.scheduledFor))));

  let dayKey = istDayKey(new Date());
  for (let i = 0; i < 400; i++) {
    const slot = new Date(`${dayKey}T${pad(hh)}:${pad(mm)}:00+05:30`);
    if (slot.getTime() > Date.now() + 60 * 1000 && !takenDays.has(dayKey)) return slot;
    dayKey = addDaysKey(dayKey, 1);
  }
  throw new Error('No free daily slot found within ~1 year');
}

const pad = (n) => String(n).padStart(2, '0');
const istDayKey = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
function addDaysKey(dayKey, n) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- advanced (legacy) filename parsing -------------------------------------
function parseLegacyName(base) {
  const parts = base.split('__').map((p) => p.trim());
  if (parts.length < 3) throw new Error(`Bad filename. Use just a number (1.mp4) or client__YYYY-MM-DD__HHMM.mp4 (got "${base}")`);
  const [clientName, datePart, timePartRaw] = parts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) throw new Error(`Bad date "${datePart}". Use YYYY-MM-DD.`);
  const digits = (timePartRaw || '').replace(/\D/g, '');
  if (digits.length !== 4) throw new Error(`Bad time "${timePartRaw}". Use HHMM 24h (e.g. 1800).`);
  const scheduledFor = new Date(`${datePart}T${digits.slice(0, 2)}:${digits.slice(2, 4)}:00+05:30`);
  if (isNaN(scheduledFor.getTime())) throw new Error(`Could not build a date from "${base}".`);
  return { clientName, scheduledFor };
}

function matchClient(clients, name) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(name);
  return (
    clients.find((c) => norm(c.name) === target) ||
    clients.find((c) => norm(c.name).includes(target) || target.includes(norm(c.name)))
  );
}

async function readSidecar(dir, base) {
  try {
    return (await fs.readFile(path.join(dir, `${base}.txt`), 'utf8')).trim();
  } catch {
    return '';
  }
}

async function autoCaptionText(client) {
  const system =
    `You are Rocky writing an Instagram Reels caption for the brand below. ` +
    `Write in the brand's voice: 1-3 short punchy lines, a soft CTA, then 5-8 relevant hashtags on a new line. ` +
    `Return ONLY the caption text.\n\n` +
    `<BRAND>\nName: ${client.name}\nIndustry: ${client.industry || 'n/a'}\n` +
    `Target market: ${client.targetMarket || 'n/a'}\nBrand notes: ${client.brandNotes || 'n/a'}\n</BRAND>`;
  const { text } = await llmChat({
    system,
    messages: [{ role: 'user', content: `Write a caption for today's reel for ${client.name}.` }],
    maxTokens: 220,
  });
  return (text || '').trim();
}

async function moveTo(dir, filename, sub) {
  const from = path.join(dir, filename);
  const to = path.join(dir, sub, stamped(filename));
  try {
    await fs.rename(from, to);
  } catch {
    const buf = await fs.readFile(from);
    await fs.writeFile(to, buf);
    await fs.unlink(from);
  }
}

async function moveSidecar(dir, base, sub) {
  try {
    await fs.access(path.join(dir, `${base}.txt`));
    await moveTo(dir, `${base}.txt`, sub);
  } catch {
    /* no sidecar */
  }
}

function stamped(filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length || undefined);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}__${ts}${ext}`;
}

function fmtIST(d) {
  return new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}