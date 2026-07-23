import { env } from '../config/env.js';

// Auto-caption a reel by LOOKING at it. GPT can't read an mp4, so we ask
// Cloudinary for still frames from the uploaded video (frame 0 + Cloudinary's
// auto-chosen representative frame — no fixed timestamps that break on short
// clips) and send those to a vision model, grounded in the client's brand.

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const MAX_HASHTAGS = Number(process.env.CAPTION_MAX_HASHTAGS || 5);

// Build still-frame image URLs from a Cloudinary video URL. 'auto' lets
// Cloudinary pick the most representative frame; '0' is the opening frame.
export function frameUrls(videoUrl, offsets = ['0', 'auto']) {
  return offsets.map((s) =>
    String(videoUrl)
      .replace('/upload/', `/upload/so_${s},w_640,h_640,c_fill/`)
      .replace(/\.\w+$/, '.jpg')
  );
}

export function visionConfigured() {
  return Boolean(env.OPENAI_API_KEY);
}

// Keep caption text + at most N relevant hashtags, on their own line.
// Guarantees the Instagram tag count no matter what the model returns.
export function capHashtags(caption, n = MAX_HASHTAGS) {
  if (!caption) return caption;
  const tags = [];
  const seen = new Set();
  for (const m of caption.matchAll(/#[\p{L}0-9_]+/gu)) {
    const t = m[0];
    const key = t.toLowerCase();
    if (!seen.has(key)) { seen.add(key); tags.push(t); }
  }
  const body = caption.replace(/#[\p{L}0-9_]+/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const kept = tags.slice(0, n);
  return kept.length ? `${body}\n\n${kept.join(' ')}` : body;
}

// Returns caption text (1-2 lines + a soft CTA + exactly N hashtags), or throws.
export async function captionFromVideo({ videoUrl, client, brief }) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set — vision captioning needs it');
  if (!videoUrl) throw new Error('No video URL to caption');

  const frames = frameUrls(videoUrl);
  const brand =
    `Brand: ${client?.name || 'the client'}. ` +
    `Industry: ${client?.industry || 'n/a'}. ` +
    `Target market: ${client?.targetMarket || 'n/a'}. ` +
    `Brand notes: ${client?.brandNotes || 'n/a'}.`;

  const system =
    `You are Rocky, an expert Instagram Reels caption writer. You are shown still frames ` +
    `sampled from a specific Reel. Write a caption that is SPECIFIC to what is actually visible ` +
    `in the frames — the real subject, setting, action, product, or mood you can see. ` +
    `Do NOT write a generic marketing caption. Do NOT describe the frames literally or say "in this video/frame". ` +
    `Format: 1-2 short punchy lines, then a soft call-to-action, then EXACTLY ${MAX_HASHTAGS} highly relevant hashtags ` +
    `on a new line (mix specific + a couple broader). Return ONLY the caption text. ${brand}`;

  const body = {
    model: VISION_MODEL,
    max_tokens: 260,
    temperature: 0.7,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: brief?.trim() || 'Write the caption based on what you actually see in these frames.' },
          ...frames.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Vision caption failed: ${JSON.stringify(d?.error || d).slice(0, 200)}`);
  const raw = (d.choices?.[0]?.message?.content || '').trim();
  return capHashtags(raw, MAX_HASHTAGS);
}