import mongoose from 'mongoose';

// A single event in Rocky's live activity stream. The dashboard polls the most
// recent rows to show a real-time "what's happening now" feed (upload →
// caption → schedule → publishing → published) instead of a static checklist.
const activitySchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true, default: null },
    clientName: { type: String, default: '' },
    // Stage of the pipeline this event belongs to.
    kind: {
      type: String,
      enum: ['upload', 'caption', 'schedule', 'publish_start', 'publish_step', 'published', 'failed', 'info'],
      default: 'info',
    },
    // Visual state for the feed row.
    state: { type: String, enum: ['running', 'success', 'error', 'info'], default: 'info' },
    title: { type: String, required: true },
    detail: { type: String, default: '' },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'ScheduledPost', default: null },
    permalink: { type: String, default: '' }, // Instagram link (set on 'published')
    thumbnailUrl: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

activitySchema.index({ createdAt: -1 });
activitySchema.index({ client: 1, createdAt: -1 });

export const Activity = mongoose.model('Activity', activitySchema);

// Fire-and-forget logger — never let a feed write break the real work.
export async function logActivity(data) {
  try {
    return await Activity.create(data);
  } catch {
    return null;
  }
}