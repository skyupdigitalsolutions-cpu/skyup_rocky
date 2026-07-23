import { ScheduledPost } from '../models/ScheduledPost.js';
import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { instagramConnector } from '../connectors/instagram.js';
import { decryptSecret } from '../lib/crypto.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { logActivity } from '../models/Activity.js';
import { getSetting } from '../models/Setting.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Publish a single ScheduledPost that has already been CLAIMED (status set to
// 'processing' by the caller). Returns the updated post. Never throws for a
// publish failure — it records the failure on the post and schedules a retry.
// Emits Activity events at each stage so the dashboard shows the real process.
export async function publishScheduledPost(postId) {
  const post = await ScheduledPost.findById(postId);
  if (!post) return null;

  const client = await Client.findById(post.client).lean();
  const clientName = client?.name || '';
  const thumb = post.media?.thumbnailUrl || '';
  post.attempts += 1;
  const settings = (await getSetting('reelsWatch', {})) || {};
  const caption = buildCaption(post, settings);

  await logActivity({
    client: post.client, clientName, kind: 'publish_start', state: 'running', post: post._id,
    title: `Publishing reel${clientName ? ` for ${clientName}` : ''}`, detail: 'Starting Instagram publish…', thumbnailUrl: thumb,
  });

  try {
    const dryRun = env.PUBLISH_DRY_RUN || !instagramConnector.isConfigured();

    if (dryRun) {
      logger.info(`[reels] DRY_RUN publish for post ${post._id} (${post.client})`);
      await logActivity({ client: post.client, clientName, kind: 'publish_step', state: 'running', post: post._id, title: 'Simulating publish (dry-run)', detail: 'PUBLISH_DRY_RUN is on', thumbnailUrl: thumb });
      await sleep(600);
      post.igContainerId = `dry_container_${Date.now()}`;
      post.igMediaId = `dry_media_${Date.now()}`;
      post.permalink = '';
      post.dryRun = true;
      finishPublished(post);
      await post.save();
      await logActivity({ client: post.client, clientName, kind: 'published', state: 'success', post: post._id, title: `Published (dry-run)${clientName ? ` · ${clientName}` : ''}`, detail: 'Simulated — no real post made', thumbnailUrl: thumb });
      return post;
    }

    // --- Real publish ---------------------------------------------------------
    const igUserId = client?.accountRefs?.instagramUserId;
    if (!igUserId) throw new Error('Client has no instagramUserId set (accountRefs.instagramUserId)');

    const integration = await Integration.findOne({ client: post.client, provider: 'instagram', status: 'connected' }).select('+credentials');
    const enc = integration?.credentials?.get?.('accessToken');
    const token = enc ? decryptSecret(enc) : null;
    if (!token) throw new Error('Instagram not connected for this client');
    if (!post.media?.videoUrl) throw new Error('Post has no media.videoUrl');

    // 1) container
    const containerId = await instagramConnector.createReelContainer({ igUserId, token, videoUrl: post.media.videoUrl, caption });
    post.igContainerId = containerId;
    await post.save();
    await logActivity({ client: post.client, clientName, kind: 'publish_step', state: 'running', post: post._id, title: 'Uploaded to Instagram', detail: 'Instagram is processing the video…', thumbnailUrl: thumb });

    // 2) wait for processing (reels transcode async). Poll up to ~5 min.
    const st = await waitForContainer(containerId, token);
    if (st !== 'FINISHED') throw new Error(`Container not ready (status=${st})`);

    // 3) publish
    const mediaId = await instagramConnector.publishContainer({ igUserId, token, containerId });
    post.igMediaId = mediaId;
    post.permalink = await instagramConnector.getPermalink({ mediaId, token });
    post.dryRun = false;
    finishPublished(post);
    await post.save();

    await logActivity({
      client: post.client, clientName, kind: 'published', state: 'success', post: post._id,
      title: `Reel is live${clientName ? ` · ${clientName}` : ''} 🎉`,
      detail: post.permalink ? 'Tap to view on Instagram' : 'Published',
      permalink: post.permalink, thumbnailUrl: thumb,
    });
    logger.info(`[reels] published post ${post._id} -> media ${mediaId}`);
    return post;
  } catch (err) {
    post.lastError = String(err.message || err).slice(0, 500);
    const willRetry = post.attempts < post.maxAttempts;
    if (willRetry) {
      post.status = 'retry';
      post.nextRetryAt = new Date(Date.now() + backoffMs(post.attempts));
    } else {
      post.status = 'failed';
      post.nextRetryAt = null;
    }
    await post.save();
    await logActivity({
      client: post.client, clientName, kind: 'failed', state: 'error', post: post._id,
      title: willRetry ? 'Publish failed — will retry' : 'Publish failed', detail: post.lastError, thumbnailUrl: thumb,
    });
    logger.warn({ err: post.lastError }, `[reels] publish failed for post ${post._id} (attempt ${post.attempts})`);
    return post;
  }
}

async function waitForContainer(containerId, token, { timeoutMs = 5 * 60 * 1000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await instagramConnector.getContainerStatus({ containerId, token });
    if (status === 'FINISHED') return 'FINISHED';
    if (status === 'ERROR' || status === 'EXPIRED') return status;
    await sleep(intervalMs);
  }
  return 'TIMEOUT';
}

function finishPublished(post) {
  post.status = 'published';
  post.publishedAt = new Date();
  post.lastError = '';
  post.nextRetryAt = null;
}

function buildCaption(post, settings = {}) {
  const tags = (post.hashtags || []).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
  const parts = [post.caption?.trim(), tags.join(' ')];
  // Consistent collaborator @mentions (IG API can't add true co-authors).
  if (settings.collabEnabled && Array.isArray(settings.collaborators) && settings.collaborators.length) {
    const mentions = settings.collaborators
      .map((h) => `@${String(h).replace(/^@/, '').trim()}`)
      .filter((h) => h.length > 1);
    if (mentions.length) parts.push(`\u2728 In collab with ${mentions.join(' ')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

const backoffMs = (attempt) => Math.min(60 * 60 * 1000, 5 * 60 * 1000 * attempt);