import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Client } from '../models/Client.js';
import { Document, DocumentChunk } from '../models/Document.js';

// After consolidating everything into the single "Ad Knowledge Base" master
// collection, remove the older separate knowledge collections so their content
// isn't retrieved twice. Safe: only deletes the named KB system-clients.
// Run once:  node src/seed/purgeOldKB.js

const REMOVE = ['Marketing Strategy KB', 'Execution Knowledge KB'];

async function main() {
  await connectDb();
  for (const name of REMOVE) {
    const kb = await Client.findOne({ name });
    if (!kb) { console.log(`• ${name}: not present (nothing to remove)`); continue; }
    const chunks = await DocumentChunk.deleteMany({ client: kb._id });
    const docs = await Document.deleteMany({ client: kb._id });
    await Client.deleteOne({ _id: kb._id });
    console.log(`✅ Removed "${name}" — ${docs.deletedCount} docs, ${chunks.deletedCount} chunks`);
  }
  console.log('\nDone. All ad knowledge now lives in the single "Ad Knowledge Base" master collection.');
  await mongoose.disconnect();
}

main().catch((err) => { console.error('❌ purge failed:', err.message); process.exit(1); });