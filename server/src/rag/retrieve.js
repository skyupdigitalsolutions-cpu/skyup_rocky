import mongoose from 'mongoose';
import { DocumentChunk, Document } from '../models/Document.js';
import { embed } from '../llm/embeddings.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Retrieve the top-K most relevant chunks for a query, ALWAYS scoped to a single
// client (PRD 3.2/9 — no cross-client leakage). Tries Atlas $vectorSearch first;
// if the index is absent (e.g. local dev / mock embeddings) it falls back to an
// in-memory cosine scan over that client's chunks.
export async function retrieveForClient(clientId, query, { k = 6 } = {}) {
  if (!clientId) return []; // aggregate view has no single-client doc context
  const qVec = await embed(query);

  try {
    const results = await DocumentChunk.aggregate([
      {
        $vectorSearch: {
          index: env.VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector: qVec,
          numCandidates: Math.max(100, k * 15),
          limit: k,
          filter: { client: new mongoose.Types.ObjectId(String(clientId)) },
        },
      },
      { $project: { text: 1, document: 1, order: 1, score: { $meta: 'vectorSearchScore' } } },
    ]);
    if (results?.length) return decorate(results);
    // Empty result may mean "no docs" OR "no index" — try fallback to be safe.
  } catch (err) {
    logger.warn({ err: err.message }, '[rag] $vectorSearch unavailable — using cosine fallback');
  }

  return cosineFallback(clientId, qVec, k);
}

async function cosineFallback(clientId, qVec, k) {
  const chunks = await DocumentChunk.find({ client: clientId })
    .select('text document order embedding')
    .limit(2000)
    .lean();

  const scored = chunks
    .map((c) => ({ ...c, score: cosine(qVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return decorate(scored);
}

async function decorate(rows) {
  const docIds = [...new Set(rows.map((r) => String(r.document)))];
  const docs = await Document.find({ _id: { $in: docIds } }).select('title kind').lean();
  const byId = Object.fromEntries(docs.map((d) => [String(d._id), d]));
  return rows.map((r) => ({
    text: r.text,
    score: r.score,
    documentTitle: byId[String(r.document)]?.title || 'Document',
    documentKind: byId[String(r.document)]?.kind || 'other',
  }));
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
