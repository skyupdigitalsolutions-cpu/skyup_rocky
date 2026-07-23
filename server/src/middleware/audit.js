import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../lib/logger.js';

// Fire-and-forget audit write. Never throws into the request path.
export async function audit(req, action, { targetType = '', targetId = '', meta = {} } = {}) {
  try {
    await AuditLog.create({
      actor: req.user?._id || null,
      actorEmail: req.user?.email || '',
      action,
      targetType,
      targetId: String(targetId || ''),
      meta,
      ip: req.ip,
    });
  } catch (err) {
    logger.warn({ err }, '[audit] failed to write log');
  }
}
