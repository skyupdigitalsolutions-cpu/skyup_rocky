import mongoose from 'mongoose';

// Generic runtime settings store (key -> arbitrary value). Used for config that
// admins change from the UI without a redeploy, e.g. the reels watch folder.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const Setting = mongoose.model('Setting', settingSchema);

export async function getSetting(key, fallback = null) {
  const doc = await Setting.findOne({ key }).lean();
  return doc ? doc.value : fallback;
}

export async function setSetting(key, value) {
  await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
  return value;
}