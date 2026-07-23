import mongoose from 'mongoose';

// AI-generated insight/alert — always tagged with the evidence it was built on.
const insightSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true, default: null },
    kind: { type: String, enum: ['insight', 'alert'], default: 'insight' },
    severity: { type: String, enum: ['info', 'attention', 'critical'], default: 'info' },
    source: { type: String, enum: ['meta', 'google_ads', 'search_console', 'ga4', 'mixed'], default: 'mixed' },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    evidence: [{ type: String }], // human-readable evidence lines w/ period + source
    period: { type: String, default: '' },
    acknowledged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

insightSchema.index({ createdAt: -1 });

export const Insight = mongoose.model('Insight', insightSchema);

const dailyBriefSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true }, // YYYY-MM-DD (brief tz)
    summary: { type: String, default: '' },
    priorities: [{ type: String }],
    // References to insights surfaced in this brief for drill-down.
    items: [
      {
        client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
        clientName: String,
        severity: { type: String, enum: ['info', 'attention', 'critical'], default: 'info' },
        headline: String,
        source: String,
      },
    ],
    generatedFrom: {
      clientsCount: Number,
      connectorsAvailable: [String],
      staleOrMissing: [String], // connectors that were stale/unavailable
    },
  },
  { timestamps: true }
);

export const DailyBrief = mongoose.model('DailyBrief', dailyBriefSchema);
