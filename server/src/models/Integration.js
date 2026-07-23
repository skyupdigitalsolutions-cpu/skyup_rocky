import mongoose from 'mongoose';

export const PROVIDERS = ['meta', 'google_ads', 'search_console', 'ga4', 'instagram'];

// One row per (client, provider). Tokens/secrets are stored encrypted in
// `credentials` (ciphertext strings) and are `select:false` so they never
// leave the server by default. Frontend only ever sees status + metadata.
const integrationSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    provider: { type: String, enum: PROVIDERS, required: true },
    status: {
      type: String,
      enum: ['not_connected', 'connected', 'error', 'revoked'],
      default: 'not_connected',
    },
    // Ciphertext blobs (AES-256-GCM). e.g. { accessToken, refreshToken, ... }
    credentials: {
      type: Map,
      of: String,
      select: false,
      default: {},
    },
    // Non-secret metadata safe to show in the UI.
    accountLabel: { type: String, default: '' },
    externalAccountId: { type: String, default: '' },
    scopes: [{ type: String }],
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

integrationSchema.index({ client: 1, provider: 1 }, { unique: true });

integrationSchema.methods.toPublicJSON = function toPublicJSON() {
  const { _id, client, provider, status, accountLabel, externalAccountId, scopes, lastSyncAt, lastError, updatedAt } = this;
  return { id: _id, client, provider, status, accountLabel, externalAccountId, scopes, lastSyncAt, lastError, updatedAt };
};

export const Integration = mongoose.model('Integration', integrationSchema);
