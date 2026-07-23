import mongoose from 'mongoose';

// Raw, normalized metric snapshots pulled from connectors. Kept strictly
// separate from AI-generated insights (PRD Section 15). Every snapshot records
// its source + the date window it covers so answers can cite provenance.
const metricSnapshotSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    source: {
      type: String,
      enum: ['meta', 'google_ads', 'search_console', 'ga4'],
      required: true,
    },
    // Level of aggregation for ads sources.
    level: { type: String, enum: ['account', 'campaign', 'adset', 'ad', 'page', 'query'], default: 'campaign' },
    entityId: { type: String, default: '' }, // campaign id, page url, query text...
    entityName: { type: String, default: '' },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    // Normalized metric bag. Only fields available from the source are set.
    metrics: {
      spend: Number,
      impressions: Number,
      reach: Number,
      clicks: Number,
      ctr: Number,
      cpc: Number,
      cpm: Number,
      conversions: Number,
      costPerResult: Number,
      conversionValue: Number,
      roas: Number,
      // SEO
      position: Number,
      // GA4
      sessions: Number,
      engagedSessions: Number,
      events: Number,
    },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

metricSnapshotSchema.index({ client: 1, source: 1, periodEnd: -1 });

export const MetricSnapshot = mongoose.model('MetricSnapshot', metricSnapshotSchema);
