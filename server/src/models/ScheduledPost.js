import mongoose from 'mongoose';

// One scheduled social post (V1: Instagram Reels). Kept multi-client and
// multi-platform from day one so the same queue drives future channels.
// Lifecycle: draft -> scheduled -> processing -> published | failed | canceled.
// publishMode encodes the harness rule: 'auto' (upload = pre-approval, fires on
// schedule) or 'approval' (holds until a human taps approve). Reels default auto.
const scheduledPostSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    platform: { type: String, enum: ['instagram'], default: 'instagram' },
    mediaType: { type: String, enum: ['reel', 'image', 'carousel', 'story'], default: 'reel' },

    caption: { type: String, default: '' },
    hashtags: [{ type: String }],

    // The media already lives in object storage (Cloudinary). We only keep the
    // public URL the Graph API will fetch, plus metadata for the UI.
    media: {
      videoUrl: { type: String, default: '' },
      publicId: { type: String, default: '' }, // cloudinary public_id (for cleanup)
      thumbnailUrl: { type: String, default: '' },
      durationSec: { type: Number, default: 0 },
      sizeBytes: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },

    scheduledFor: { type: Date, required: true, index: true },
    timezone: { type: String, default: 'Asia/Kolkata' },

    status: {
      type: String,
      enum: ['draft', 'scheduled', 'processing', 'published', 'failed', 'canceled', 'retry'],
      default: 'scheduled',
      index: true,
    },
    publishMode: { type: String, enum: ['auto', 'approval'], default: 'auto' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },

    // Provider round-trip artifacts.
    igContainerId: { type: String, default: '' },
    igMediaId: { type: String, default: '' },
    permalink: { type: String, default: '' },

    // Reliability bookkeeping.
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastError: { type: String, default: '' },
    nextRetryAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    dryRun: { type: Boolean, default: false }, // true if published via simulation

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// The poller's hot query: due, claimable posts, oldest first.
scheduledPostSchema.index({ status: 1, scheduledFor: 1 });

export const ScheduledPost = mongoose.model('ScheduledPost', scheduledPostSchema);
