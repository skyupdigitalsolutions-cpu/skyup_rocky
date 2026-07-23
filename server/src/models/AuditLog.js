import mongoose from 'mongoose';

// Append-only audit trail for important integration and AI actions (PRD 10).
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorEmail: { type: String, default: '' },
    action: { type: String, required: true }, // e.g. "integration.connect", "chat.query", "client.create"
    targetType: { type: String, default: '' }, // "client" | "integration" | "document" | ...
    targetId: { type: String, default: '' },
    meta: { type: Object, default: {} }, // non-sensitive context only
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
