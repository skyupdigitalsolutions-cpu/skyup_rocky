import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // e.g. "Meta Ads", "SEO", "PPC"
    status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
    monthlyBudget: { type: Number, default: null }, // INR
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    name: String,
    role: String,
    email: String,
    phone: String,
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    industry: { type: String, default: '' },
    website: { type: String, default: '' },
    status: { type: String, enum: ['active', 'prospect', 'paused', 'churned'], default: 'active' },
    // Client Brain profile fields
    goals: { type: String, default: '' },
    targetMarket: { type: String, default: '' },
    brandNotes: { type: String, default: '' },
    services: [serviceSchema],
    contacts: [contactSchema],
    // Loose external account references (the encrypted tokens live on Integration).
    accountRefs: {
      metaAdAccountId: { type: String, default: '' },
      googleAdsCustomerId: { type: String, default: '' },
      gscSiteUrl: { type: String, default: '' },
      ga4PropertyId: { type: String, default: '' },
      instagramUserId: { type: String, default: '' }, // IG business account id (for reel publishing)
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

clientSchema.index({ name: 'text', industry: 'text', brandNotes: 'text' });

export const Client = mongoose.model('Client', clientSchema);
