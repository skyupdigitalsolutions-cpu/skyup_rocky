import { Document, DocumentChunk } from '../models/Document.js';
import { chunkText } from './chunker.js';
import { embedMany } from '../llm/embeddings.js';
import { logger } from '../lib/logger.js';

// Process a document into embedded, client-scoped chunks. Idempotent per doc:
// clears prior chunks first. Designed to be called from a background job so it
// never blocks the upload request (PRD 15: use background jobs for sync work).
export async function ingestDocument(documentId, rawText) {
  const doc = await Document.findById(documentId);
  if (!doc) throw new Error('Document not found');

  try {
    doc.status = 'processing';
    await doc.save();

    await DocumentChunk.deleteMany({ document: doc._id });

    const pieces = chunkText(rawText);
    if (pieces.length === 0) {
      doc.status = 'ready';
      doc.chunkCount = 0;
      await doc.save();
      return { chunks: 0 };
    }

    const vectors = await embedMany(pieces.map((p) => p.text));

    await DocumentChunk.insertMany(
      pieces.map((p, i) => ({
        client: doc.client,
        document: doc._id,
        order: p.order,
        text: p.text,
        tokens: p.tokens,
        embedding: vectors[i],
      }))
    );

    doc.status = 'ready';
    doc.chunkCount = pieces.length;
    doc.error = '';
    await doc.save();
    logger.info(`[rag] ingested doc ${doc._id} (${pieces.length} chunks)`);
    return { chunks: pieces.length };
  } catch (err) {
    doc.status = 'failed';
    doc.error = err.message?.slice(0, 500) || 'ingest failed';
    await doc.save();
    logger.error({ err }, `[rag] ingest failed for doc ${doc._id}`);
    throw err;
  }
}
