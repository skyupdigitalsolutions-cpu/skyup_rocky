import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Client } from '../models/Client.js';
import { Document, DocumentChunk } from '../models/Document.js';
import { embedMany } from '../llm/embeddings.js';
import { env } from '../config/env.js';

// Ingest a curated ads-knowledge pack (rag_chunks.jsonl) into Rocky's RAG so the
// campaign builder is grounded in current, sourced Meta/Google rules.
//
// Each JSONL record: { id, platform, country, knowledge_version, retrieved_at,
//   source_type, source_urls[], path, text }.  We store each record as ONE chunk
// (no re-chunking — it's already curated) under a dedicated "Ad Knowledge Base"
// client, with source + version kept inside the chunk text so retrieval carries
// provenance. Zero client/CRM data — global advertising knowledge only.
//
// Usage (from the server folder):
//   node src/seed/adKnowledge.js                      # reads src/seed/ads-knowledge/rag_chunks.jsonl
//   node src/seed/adKnowledge.js path\to\rag_chunks.jsonl
//   node src/seed/adKnowledge.js path\to\rag_chunks.jsonl "Marketing Strategy KB"   # named collection
//
// REQUIRES real embeddings: set EMBEDDINGS_PROVIDER=openai in .env.

const KB_NAME = process.argv[3] || 'Ad Knowledge Base';
const DEFAULT_JSONL = path.resolve(process.cwd(), 'src/seed/ads-knowledge/rag_chunks.jsonl');

async function main() {
  const jsonlPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_JSONL;

  let raw;
  try {
    raw = await fs.readFile(jsonlPath, 'utf8');
  } catch {
    console.error(`\n❌ Could not find the knowledge file at:\n   ${jsonlPath}\n`);
    console.error('Fix: extract the pack so this file exists:');
    console.error('   server/src/seed/ads-knowledge/rag_chunks.jsonl');
    console.error('or pass the path:  node src/seed/adKnowledge.js "C:\\\\path\\\\to\\\\rag_chunks.jsonl"\n');
    process.exit(1);
  }

  const records = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { console.warn(`  ! skipped malformed line ${i + 1}`); return null; }
  }).filter(Boolean);

  if (!records.length) { console.error('No records found in the JSONL.'); process.exit(1); }

  await connectDb();
  if (env.EMBEDDINGS_PROVIDER !== 'openai') {
    console.warn('\n⚠  EMBEDDINGS_PROVIDER is not "openai" — retrieval will use MOCK vectors (not meaningful).');
    console.warn('   Set EMBEDDINGS_PROVIDER=openai and EMBEDDINGS_MODEL=text-embedding-3-small in .env, then re-run.\n');
  }

  // KB client
  let kb = await Client.findOne({ name: KB_NAME });
  if (!kb) {
    kb = await Client.create({ name: KB_NAME, industry: 'Internal knowledge base', status: 'prospect',
      brandNotes: 'System client holding global Meta/Google ads knowledge for RAG. Not a real client. No CRM data.' });
    console.log('Created knowledge-base client:', KB_NAME);
  }

  // Idempotent full reload: wipe prior KB docs + chunks.
  const oldDocs = await Document.find({ client: kb._id }).select('_id').lean();
  if (oldDocs.length) {
    await DocumentChunk.deleteMany({ client: kb._id });
    await Document.deleteMany({ client: kb._id });
    console.log(`Cleared ${oldDocs.length} previous knowledge doc(s).`);
  }

  // Group records by their source .md path → one Document per file.
  const byPath = new Map();
  for (const r of records) {
    const key = r.path || r.id || 'misc';
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(r);
  }

  const version = records[0]?.knowledge_version || 'n/a';
  let totalChunks = 0;

  for (const [docPath, recs] of byPath) {
    const doc = await Document.create({
      client: kb._id,
      title: docPath,
      kind: 'campaign',
      mimeType: 'text/markdown',
      status: 'processing',
    });

    const vectors = await embedMany(recs.map((r) => r.text));
    await DocumentChunk.insertMany(recs.map((r, i) => ({
      client: kb._id,
      document: doc._id,
      order: i,
      text: r.text,
      tokens: Math.ceil((r.text || '').length / 4),
      embedding: vectors[i],
      embeddingModel: env.EMBEDDINGS_MODEL,
      embeddingDim: env.EMBEDDINGS_DIM,
    })));

    doc.status = 'ready';
    doc.chunkCount = recs.length;
    await doc.save();
    totalChunks += recs.length;
    console.log(`  • ${docPath} — ${recs.length} chunk(s)`);
  }

  const platforms = records.reduce((m, r) => { const k = r.platform || r.collection || 'general'; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`\n✅ Ad Knowledge Base ready — ${byPath.size} docs, ${totalChunks} chunks (v${version}).`);
  console.log(`   Platforms: ${Object.entries(platforms).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  console.log('   Campaign drafting is now grounded in this pack. Re-run anytime you refresh the JSONL.\n');
  await mongoose.disconnect();
}

main().catch((err) => { console.error('\n❌ adKnowledge ingest failed:', err.message, '\n'); process.exit(1); });