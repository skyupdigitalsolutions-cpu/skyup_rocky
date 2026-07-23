import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Client } from '../models/Client.js';

// Remove all demo/other clients, keeping ONLY Skyup Digital Solutions, and
// cascade-delete their related data so nothing is left orphaned.
// Run once from the server folder:  node src/seed/cleanup.js

const KEEP = /skyup/i;

// Related collections keyed by a `client` field. Loaded dynamically so a
// missing model never breaks the cleanup.
const RELATED = [
  ['../models/Integration.js', 'Integration'],
  ['../models/ScheduledPost.js', 'ScheduledPost'],
  ['../models/MetricSnapshot.js', 'MetricSnapshot'],
  ['../models/Insight.js', 'Insight'],
  ['../models/Activity.js', 'Activity'],
  ['../models/Conversation.js', 'Conversation'],
  ['../models/Document.js', 'Document'],
];

async function main() {
  await connectDb();

  const all = await Client.find({}).select('_id name').lean();
  const remove = all.filter((c) => !KEEP.test(c.name || ''));
  const keep = all.filter((c) => KEEP.test(c.name || ''));

  console.log(`Found ${all.length} clients.`);
  console.log(`Keeping: ${keep.map((c) => c.name).join(', ') || '(none — is Skyup seeded?)'}`);
  console.log(`Removing: ${remove.map((c) => c.name).join(', ') || '(none)'}`);

  if (!remove.length) {
    console.log('\nNothing to remove. Done.');
    await mongoose.disconnect();
    return;
  }

  const ids = remove.map((c) => c._id);

  for (const [path, name] of RELATED) {
    try {
      const mod = await import(path);
      const Model = mod[name] || mod.default;
      if (!Model?.deleteMany) continue;
      const r = await Model.deleteMany({ client: { $in: ids } });
      if (r.deletedCount) console.log(`  - ${name}: removed ${r.deletedCount}`);
    } catch (e) {
      console.log(`  - ${name}: skipped (${e.message.slice(0, 60)})`);
    }
  }

  const r = await Client.deleteMany({ _id: { $in: ids } });
  console.log(`\n✅ Removed ${r.deletedCount} clients and their data. Skyup Digital Solutions kept.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\n❌ cleanup failed:', err.message, '\n');
  process.exit(1);
});