import { Router } from 'express';
import { z } from 'zod';
import { ScheduledPost } from '../models/ScheduledPost.js';
import { Client } from '../models/Client.js';
import { Activity } from '../models/Activity.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canAccessClient, scopedClientFilter } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';
import { signUpload } from '../lib/cloudinary.js';
import { llmChat } from '../llm/provider.js';
import { publishScheduledPost } from '../services/reelsPublisher.js';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWatchStatus, resolveConfig, scanNow } from '../jobs/folderWatcher.js';
import { setSetting } from '../models/Setting.js';

const router = Router();
router.use(requireAuth);

// ---- Live activity feed -----------------------------------------------------
// Powers the dashboard "what's happening now" stream. Newest first.
router.get(
  '/activity',
  requirePermission(PERMISSIONS.REELS_READ),
  asyncHandler(async (req, res) => {
    const { client, limit } = req.query;
    const filter = {};
    if (client) {
      if (!canAccessClient(req.user, client)) throw new HttpError(403, 'Client not in your scope');
      filter.client = client;
    } else {
      const scope = scopedClientFilter(req.user);
      if (scope) filter.client = scope._id;
    }
    const n = Math.min(Number(limit) || 40, 100);
    const activity = await Activity.find(filter).sort({ createdAt: -1 }).limit(n).lean();
    res.json({ activity });
  })
);

// ---- Watch-folder automation config (admin) ---------------------------------
router.get(
  '/watch-config',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  asyncHandler(async (req, res) => {
    const config = await resolveConfig();
    res.json({ config, status: getWatchStatus() });
  })
);

const watchSchema = z.object({
  enabled: z.boolean(),
  dir: z.string().default(''),
  intervalSec: z.number().min(5).max(3600).default(20),
  defaultClient: z.string().default('Skyup'),
  dailyTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM 24h, e.g. 18:00').default('18:00'),
});

router.put(
  '/watch-config',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  asyncHandler(async (req, res) => {
    const body = watchSchema.parse(req.body);
    if (body.enabled && body.dir) {
      try {
        const st = await fs.stat(body.dir);
        if (!st.isDirectory()) throw new Error('not a directory');
      } catch {
        throw new HttpError(400, `Folder not found or not accessible on the server: ${body.dir}`);
      }
    }
    await setSetting('reelsWatch', body);
    await audit(req, 'reels.watch_config', { meta: { enabled: body.enabled, dir: body.dir, dailyTime: body.dailyTime, defaultClient: body.defaultClient } });
    res.json({ config: body, status: getWatchStatus() });
  })
);

router.post(
  '/watch-config/scan-now',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  asyncHandler(async (req, res) => {
    const result = await scanNow();
    res.json({ result, status: getWatchStatus() });
  })
);

// ---- List (calendar feed) ---------------------------------------------------
router.get(
  '/',
  requirePermission(PERMISSIONS.REELS_READ),
  asyncHandler(async (req, res) => {
    const { client, from, to, status } = req.query;
    const filter = {};
    if (client) {
      if (!canAccessClient(req.user, client)) throw new HttpError(403, 'Client not in your scope');
      filter.client = client;
    } else {
      const scope = scopedClientFilter(req.user);
      if (scope) filter.client = scope._id;
    }
    if (status) filter.status = status;
    if (from || to) {
      filter.scheduledFor = {};
      if (from) filter.scheduledFor.$gte = new Date(from);
      if (to) filter.scheduledFor.$lte = new Date(to);
    }
    const posts = await ScheduledPost.find(filter).sort({ scheduledFor: 1 }).limit(500).lean();
    res.json({ posts });
  })
);

router.post(
  '/upload-signature',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    res.json(signUpload({ folder: req.body?.folder }));
  })
);

const mediaSchema = z.object({
  videoUrl: z.string().url(),
  publicId: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().optional(),
  sizeBytes: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const createSchema = z.object({
  client: z.string(),
  media: mediaSchema,
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  scheduledFor: z.string(),
  timezone: z.string().optional(),
  publishMode: z.enum(['auto', 'approval']).optional(),
});

router.post(
  '/',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (!canAccessClient(req.user, body.client)) throw new HttpError(403, 'Client not in your scope');
    const post = await ScheduledPost.create({
      client: body.client,
      media: body.media,
      caption: body.caption || '',
      hashtags: body.hashtags || [],
      scheduledFor: new Date(body.scheduledFor),
      timezone: body.timezone || 'Asia/Kolkata',
      publishMode: body.publishMode || 'auto',
      status: 'scheduled',
      createdBy: req.user._id,
    });
    await audit(req, 'reel.schedule', { targetType: 'scheduled_post', targetId: post._id, meta: { client: body.client } });
    res.status(201).json({ post });
  })
);

router.post(
  '/caption',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    const { client: clientId, brief } = z.object({ client: z.string(), brief: z.string().optional() }).parse(req.body);
    if (!canAccessClient(req.user, clientId)) throw new HttpError(403, 'Client not in your scope');
    const c = await Client.findById(clientId).lean();
    if (!c) throw new HttpError(404, 'Client not found');
    const system =
      `You are Rocky, writing an Instagram Reels caption for the brand below. ` +
      `Write in the brand's voice. Keep it punchy (1–3 short lines), add a soft CTA, ` +
      `then 5–8 relevant hashtags on a new line. Return ONLY the caption text.\n\n` +
      `<BRAND>\nName: ${c.name}\nIndustry: ${c.industry || 'n/a'}\n` +
      `Target market: ${c.targetMarket || 'n/a'}\nBrand notes: ${c.brandNotes || 'n/a'}\n</BRAND>`;
    const user = brief?.trim() || `Write a caption for today's reel for ${c.name}.`;
    const { text } = await llmChat({ system, messages: [{ role: 'user', content: user }], maxTokens: 300 });
    res.json({ caption: text });
  })
);

const patchSchema = z.object({
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  scheduledFor: z.string().optional(),
  publishMode: z.enum(['auto', 'approval']).optional(),
});

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    const post = await loadEditable(req);
    const body = patchSchema.parse(req.body);
    if (body.caption !== undefined) post.caption = body.caption;
    if (body.hashtags !== undefined) post.hashtags = body.hashtags;
    if (body.scheduledFor) post.scheduledFor = new Date(body.scheduledFor);
    if (body.publishMode) post.publishMode = body.publishMode;
    if (['failed', 'canceled'].includes(post.status)) { post.status = 'scheduled'; post.attempts = 0; post.lastError = ''; }
    await post.save();
    await audit(req, 'reel.edit', { targetType: 'scheduled_post', targetId: post._id });
    res.json({ post });
  })
);

router.post(
  '/:id/approve',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    const post = await loadEditable(req);
    post.approvedBy = req.user._id;
    post.approvedAt = new Date();
    if (post.status === 'draft') post.status = 'scheduled';
    await post.save();
    await audit(req, 'reel.approve', { targetType: 'scheduled_post', targetId: post._id });
    res.json({ post });
  })
);

router.post(
  '/:id/publish-now',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    const claimed = await ScheduledPost.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['scheduled', 'retry', 'failed', 'draft'] } },
      { $set: { status: 'processing' } },
      { new: true }
    );
    if (!claimed) throw new HttpError(409, 'Post is not in a publishable state');
    if (!canAccessClient(req.user, claimed.client)) throw new HttpError(403, 'Client not in your scope');
    const post = await publishScheduledPost(claimed._id);
    await audit(req, 'reel.publish_now', { targetType: 'scheduled_post', targetId: claimed._id, meta: { status: post?.status } });
    res.json({ post });
  })
);

router.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    const post = await loadEditable(req);
    post.status = 'canceled';
    await post.save();
    await audit(req, 'reel.cancel', { targetType: 'scheduled_post', targetId: post._id });
    res.json({ post });
  })
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.REELS_WRITE),
  asyncHandler(async (req, res) => {
    const post = await ScheduledPost.findById(req.params.id);
    if (!post) throw new HttpError(404, 'Post not found');
    if (!canAccessClient(req.user, post.client)) throw new HttpError(403, 'Client not in your scope');
    await post.deleteOne();
    await audit(req, 'reel.delete', { targetType: 'scheduled_post', targetId: req.params.id });
    res.json({ ok: true });
  })
);

async function loadEditable(req) {
  const post = await ScheduledPost.findById(req.params.id);
  if (!post) throw new HttpError(404, 'Post not found');
  if (!canAccessClient(req.user, post.client)) throw new HttpError(403, 'Client not in your scope');
  if (post.status === 'processing') throw new HttpError(409, 'Post is currently publishing');
  return post;
}

// ---- Native folder picker (Windows: PowerShell dialog) ----------------------
router.post(
  '/watch-config/browse',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  asyncHandler(async (req, res) => {
    if (process.platform !== 'win32') return res.json({ unsupported: true, path: null });
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = "Select the Rocky Reels watch folder"',
      '$d.ShowNewFolderButton = $true',
      'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }',
    ].join('; ');
    try {
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 60000 });
      res.json({ path: stdout.trim() || null });
    } catch (err) {
      throw new HttpError(500, `Folder picker failed: ${err.message?.slice(0, 200)}`);
    }
  })
);

export default router;