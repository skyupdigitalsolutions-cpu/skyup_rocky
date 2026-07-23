import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New conversation' },
    // Context selected in the chat UI. `client: null` => "All Clients" view.
    context: {
      client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
      dateRange: {
        preset: { type: String, default: 'last_7d' }, // last_7d | last_28d | last_90d | custom
        start: { type: Date, default: null },
        end: { type: Date, default: null },
      },
      service: { type: String, default: '' },
    },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Conversation = mongoose.model('Conversation', conversationSchema);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    // For assistant messages: what grounded this answer (sources + period).
    grounding: {
      sources: [{ type: String }], // e.g. "Meta Ads (last 7d)", "doc:Brief.pdf"
      period: { type: String, default: '' },
      toolCalls: [{ name: String, ok: Boolean, note: String }],
      missing: [{ type: String }], // what data was unavailable
    },
  },
  { timestamps: true }
);

export const Message = mongoose.model('Message', messageSchema);
