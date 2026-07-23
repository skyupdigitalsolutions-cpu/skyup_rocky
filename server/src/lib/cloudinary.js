import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

// Cloudinary signed uploads.
//  - signUpload(): mints a short signature so the BROWSER uploads the video
//    straight to Cloudinary (used by the Reels page).
//  - uploadLocalVideo(): uploads a file ALREADY ON DISK (used by the watch
//    folder automation — the Node server can read local paths the browser can't).
// No SDK: signing = sorted param string + api_secret, sha1-hex.

export function cloudinaryConfigured() {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

function sign(params) {
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(sorted + env.CLOUDINARY_API_SECRET).digest('hex');
}

export function signUpload({ folder } = {}) {
  if (!cloudinaryConfigured()) {
    const e = new Error('Cloudinary is not configured — set CLOUDINARY_* in .env');
    e.status = 400;
    throw e;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = { folder: folder || env.CLOUDINARY_UPLOAD_FOLDER, timestamp };
  const signature = sign(toSign);
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
    folder: toSign.folder,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/video/upload`,
  };
}

// Upload a local video file to Cloudinary (server-side). Returns normalized
// media metadata ready to store on a ScheduledPost.
export async function uploadLocalVideo(localPath, { folder } = {}) {
  if (!cloudinaryConfigured()) throw new Error('Cloudinary is not configured — set CLOUDINARY_* in .env');

  const timestamp = Math.floor(Date.now() / 1000);
  const targetFolder = folder || env.CLOUDINARY_UPLOAD_FOLDER || 'rocky/reels';
  const signature = sign({ folder: targetFolder, timestamp });

  const buf = await fs.readFile(localPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(localPath));
  form.append('api_key', env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', targetFolder);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/video/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Cloudinary upload failed: ${res.status} ${JSON.stringify(data?.error || data)}`);
  }

  // A first-frame poster (Cloudinary transformation, .jpg).
  const thumbnailUrl = String(data.secure_url || '')
    .replace('/upload/', '/upload/so_0,w_400,h_540,c_fill/')
    .replace(/\.\w+$/, '.jpg');

  return {
    videoUrl: data.secure_url,
    publicId: data.public_id,
    thumbnailUrl,
    durationSec: Math.round(data.duration || 0),
    sizeBytes: data.bytes || 0,
    width: data.width || 0,
    height: data.height || 0,
  };
}

// Upload a base64/data-URI image (e.g. an AI-generated creative) to Cloudinary,
// returns a stable secure_url we can then hand to Meta as an ad image.
export async function uploadImageBase64(dataUri, { folder } = {}) {
  if (!cloudinaryConfigured()) throw new Error('Cloudinary is not configured');
  const timestamp = Math.floor(Date.now() / 1000);
  const targetFolder = folder || env.CLOUDINARY_UPLOAD_FOLDER || 'rocky/creatives';
  const signature = sign({ folder: targetFolder, timestamp });
  const form = new URLSearchParams();
  form.append('file', dataUri.startsWith('data:') ? dataUri : `data:image/png;base64,${dataUri}`);
  form.append('api_key', env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', targetFolder);
  form.append('signature', signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST', body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cloudinary image upload failed: ${JSON.stringify(data?.error || data).slice(0,160)}`);
  return { url: data.secure_url, publicId: data.public_id };
}