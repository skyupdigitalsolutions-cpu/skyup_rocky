import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Minimal object-storage abstraction. V1 default is local disk. Swap in an S3
// implementation behind the same signatures without touching callers.
export async function saveObject(buffer, { ext = '' } = {}) {
  if (env.STORAGE_DRIVER === 's3') {
    // TODO(real): PutObject to S3_BUCKET; return the s3 key.
    throw new Error('S3 storage driver not yet implemented — set STORAGE_DRIVER=local');
  }
  const dir = path.resolve(env.LOCAL_STORAGE_DIR);
  await fs.mkdir(dir, { recursive: true });
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  await fs.writeFile(path.join(dir, key), buffer);
  return key;
}

export async function readObject(key) {
  if (env.STORAGE_DRIVER === 's3') throw new Error('S3 read not implemented');
  return fs.readFile(path.join(path.resolve(env.LOCAL_STORAGE_DIR), key));
}
