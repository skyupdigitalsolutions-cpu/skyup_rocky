import crypto from 'node:crypto';
import { env } from '../config/env.js';

// AES-256-GCM authenticated encryption for integration tokens/secrets.
// Stored payload format (base64): iv(12) | authTag(16) | ciphertext
const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex'); // 32 bytes
const IV_LEN = 12;

export function encryptSecret(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload) {
  if (payload == null) return null;
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + 16);
  const data = raw.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// Deterministic hash used for pseudo-embeddings in mock mode (never security).
export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest();
}
