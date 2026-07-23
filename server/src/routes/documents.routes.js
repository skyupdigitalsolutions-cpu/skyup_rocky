import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { Document, DocumentChunk } from '../models/Document.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canAccessClient } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';
import { saveObject } from '../lib/storage.js';
import { ingestDocument } from '../rag/ingest.js';
import { logger } from '../lib/logger.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

// List documents for a client.
router.get(
  '/:clientId',
  requirePermission(PERMISSIONS.DOCUMENT_READ),
  asyncHandler(async (req, res) => {
    if (!canAccessClient(req.user, req.params.clientId)) throw new HttpError(403, 'Client not in your scope');
    const docs = await Document.find({ client: req.params.clientId }).sort({ createdAt: -1 }).lean();
    res.json({ documents: docs });
  })
);

// Upload a file OR paste text. Text-based content is ingested for RAG
// immediately (in background); binary files are stored with extraction pending.
const pasteSchema = z.object({
  clientId: z.string(),
  title: z.string().min(1),
  kind: z.enum(['report', 'brief', 'meeting_notes', 'strategy', 'website_notes', 'campaign', 'other']).default('other'),
  text: z.string().min(1),
});

router.post(
  '/paste',
  requirePermission(PERMISSIONS.DOCUMENT_WRITE),
  asyncHandler(async (req, res) => {
    const body = pasteSchema.parse(req.body);
    if (!canAccessClient(req.user, body.clientId)) throw new HttpError(403, 'Client not in your scope');
    const doc = await Document.create({
      client: body.clientId,
      title: body.title,
      kind: body.kind,
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(body.text),
      status: 'processing',
      uploadedBy: req.user._id,
    });
    await audit(req, 'document.create', { targetType: 'document', targetId: doc._id, meta: { via: 'paste' } });
    // Ingest in background so the request returns fast (PRD 15).
    ingestDocument(doc._id, body.text).catch((err) => logger.error({ err }, 'ingest failed'));
    res.status(201).json({ document: doc });
  })
);

router.post(
  '/upload',
  requirePermission(PERMISSIONS.DOCUMENT_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { clientId, title, kind = 'other' } = req.body;
    if (!clientId || !req.file) throw new HttpError(400, 'clientId and file are required');
    if (!canAccessClient(req.user, clientId)) throw new HttpError(403, 'Client not in your scope');

    const ext = path.extname(req.file.originalname);
    const key = await saveObject(req.file.buffer, { ext });

    const isText = TEXT_TYPES.includes(req.file.mimetype) || /\.(txt|md|csv|json)$/i.test(req.file.originalname);
    const doc = await Document.create({
      client: clientId,
      title: title || req.file.originalname,
      kind,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageKey: key,
      status: isText ? 'processing' : 'uploaded',
      uploadedBy: req.user._id,
      error: isText ? '' : 'Text extraction pending: connect a PDF/DOCX extractor to enable RAG for this file type.',
    });
    await audit(req, 'document.create', { targetType: 'document', targetId: doc._id, meta: { mime: req.file.mimetype } });

    if (isText) {
      const text = req.file.buffer.toString('utf8');
      ingestDocument(doc._id, text).catch((err) => logger.error({ err }, 'ingest failed'));
    }
    // TODO(real): for pdf/docx, run an extractor (pdf-parse / mammoth) then ingestDocument().
    res.status(201).json({ document: doc });
  })
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.DOCUMENT_WRITE),
  asyncHandler(async (req, res) => {
    const doc = await Document.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (!canAccessClient(req.user, doc.client)) throw new HttpError(403, 'Client not in your scope');
    await DocumentChunk.deleteMany({ document: doc._id });
    await doc.deleteOne();
    await audit(req, 'document.delete', { targetType: 'document', targetId: doc._id });
    res.json({ ok: true });
  })
);

export default router;
