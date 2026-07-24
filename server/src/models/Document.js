import mongoose from 'mongoose';

// Uploaded client knowledge: reports, briefs, notes, strategy docs, etc.
const documentSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    title: { type: String, required: true },
    kind: {
      type: String,
      enum: ['report', 'brief', 'meeting_notes', 'strategy', 'website_notes', 'campaign', 'other'],
      default: 'other',
    },
    mimeType: { type: String, default: 'text/plain' },
    sizeBytes: { type: Number, default: 0 },
    storageKey: { type: String, default: '' }, // path/key in object storage
    status: {
      type: String,
      enum: ['uploaded', 'processing', 'ready', 'failed'],
      default: 'uploaded',
    },
    chunkCount: { type: Number, default: 0 },
    error: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const Document = mongoose.model('Document', documentSchema);

// One embedded chunk per row. `embedding` is indexed by an Atlas Vector Search
// index (see README) named by env.VECTOR_INDEX_NAME. `client` is stored on the
// chunk so retrieval is ALWAYS client-scoped (PRD 3.2 / 9: no cross-client leak).
const chunkSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    order: { type: Number, default: 0 },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    embeddingModel: { type: String, default: '' },
    embeddingDim: { type: Number, default: 0 },
    tokens: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const DocumentChunk = mongoose.model('DocumentChunk', chunkSchema);