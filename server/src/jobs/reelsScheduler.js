import { ScheduledPost } from '../models/ScheduledPost.js';
import { publishScheduledPost } from '../services/reelsPublisher.js';
import { logger } from '../lib/logger.js';

// Runs every minute (see jobs/queue.js). Finds due posts and publishes them.
// Concurrency-safe: each post is CLAIMED via an atomic findOneAndUpdate that
// flips 'scheduled'/'retry' -> 'processing', so overlapping ticks (or multiple
// workers) can never double-publish the same reel.
export async function processDuePosts({ limit = 10 } = {}) {
  const now = new Date();
  const published = [];

  for (let i = 0; i < limit; i++) {
    const post = await claimNextDuePost(now);
    if (!post) break;
    const result = await publishScheduledPost(post._id);
    published.push({ id: String(post._id), status: result?.status });
  }

  if (published.length) logger.info(`[reels] tick processed ${published.length} post(s)`);
  return published;
}

// Atomically grab one due, publishable post. Eligible:
//  - status 'scheduled' with scheduledFor <= now and publishMode 'auto'
//  - status 'scheduled' with an approval already granted (approvedAt set)
//  - status 'retry' whose nextRetryAt has arrived
async function claimNextDuePost(now) {
  return ScheduledPost.findOneAndUpdate(
    {
      $or: [
        { status: 'scheduled', scheduledFor: { $lte: now }, publishMode: 'auto' },
        { status: 'scheduled', scheduledFor: { $lte: now }, publishMode: 'approval', approvedAt: { $ne: null } },
        { status: 'retry', nextRetryAt: { $lte: now } },
      ],
    },
    { $set: { status: 'processing' } },
    { new: true, sort: { scheduledFor: 1 } }
  );
}
