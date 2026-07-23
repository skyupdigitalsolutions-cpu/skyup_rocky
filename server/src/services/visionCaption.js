import { env } from '../config/env.js';

// Full-video understanding without ffmpeg:
//   • FRAMES  — Cloudinary renders chronological still frames from the video URL
//               (~1 per second, capped), so GPT sees the whole clip's story.
//   • AUDIO   — Cloudinary delivers an audio-only .mp3 of the same video, which
//               we transcribe with Whisper, so GPT also knows what is SAID.
// Frames + transcript go to a vision model together -> a caption that's specific
// to what actually happens and is spoken in the reel.

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const WHISPER_MODEL = process.env.OPENAI_WHISPER_MODEL || 'whisper-1';
const MAX_HASHTAGS = Number(process.env.CAPTION_MAX_HASHTAGS || 5);
const MAX_FRAMES = Number(process.env.CAPTION_MAX_FRAMES || 18);

export function visionConfigured() {
  return Boolean(env.OPENAI_API_KEY);
}

// Chronological frames ~1/sec across the clip (capped), plus Cloudinary's
// auto-chosen representative frame. Falls back to safe offsets if duration
// is unknown (Cloudinary clamps out-of-range offsets to the last frame).
export function frameUrls(videoUrl, { durationSec = 0 } = {}) {
  let offsets;
  if (durationSec && durationSec >= 2) {
    const step = Math.max(1, Math.ceil(durationSec / MAX_FRAMES));
    offsets = [];
    for (let t = 0; t < durationSec && offsets.length < MAX_FRAMES; t += step) offsets.push(String(t));
    offsets.push('auto');
  } else {
    offsets = ['0', '1', '2', 'auto'];
  }
  offsets = [...new Set(offsets)];
  return offsets.map((s) =>
    String(videoUrl).replace('/upload/', `/upload/so_${s},w_640,h_640,c_fill/`).replace(/\.\w+$/, '.jpg')
  );
}

// Cloudinary can deliver the audio track of a video as mp3 by swapping the
// extension. We fetch that and transcribe with Whisper. Best-effort: returns ''
// on any failure or if the clip has no speech.
export async function transcribeAudio(videoUrl) {
  if (!env.OPENAI_API_KEY || !videoUrl) return '';
  const mp3Url = String(videoUrl).replace(/\.\w+$/, '.mp3');
  try {
    const audioRes = await fetch(mp3Url);
    if (!audioRes.ok) return '';
    const buf = Buffer.from(await audioRes.arrayBuffer());
    if (!buf.length) return '';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', WHISPER_MODEL);
    const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!wr.ok) return '';
    const d = await wr.json().catch(() => ({}));
    return (d.text || '').trim();
  } catch {
    return '';
  }
}

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

function systemPrompt(client, transcript) {
  const brand =
    `Brand: ${client?.name || 'the client'}. Industry: ${client?.industry || 'n/a'}. ` +
    `Target market: ${client?.targetMarket || 'n/a'}. Brand notes: ${client?.brandNotes || 'n/a'}.`;
  return (
    `You are a witty, culturally-aware Indian social media creator writing an Instagram Reels caption. ` +
    `You are given still frames sampled in order across ONE specific Reel` +
    (transcript ? `, plus a transcript of what is SAID in it` : '') +
    `. Understand the full story and write a caption that ONLY fits THIS video.\n\n` +
    `Voice & style:\n` +
    `- Lead with a punchy, relatable or funny HOOK about what actually happens. Emojis welcome.\n` +
    `- Human and conversational, never corporate. Brand mention should feel natural, not like an ad.\n` +
    `- 1-3 short lines, optional soft CTA, then up to ${MAX_HASHTAGS} genuinely relevant hashtags on a new line.\n` +
    `- Do NOT narrate the frames ("in this video…"). Do NOT write generic marketing filler.\n` +
    `- BANNED phrases (never use these or similar): "Ignite your ideas", "Dive into the future", "Elevate", ` +
    `"Unlock", "Unleash", "Take your business to the next level", "Boost your business", "Let's make ... a reality", ` +
    `"one call at a time", "Turning ideas into action".\n\n` +
    `${brand}\nReturn ONLY the caption text.`
  );
}

// Primary caption (backward-compatible string) — used by the autopilot.
export async function captionFromVideo({ videoUrl, client, brief, durationSec = 0 }) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set — vision captioning needs it');
  if (!videoUrl) throw new Error('No video URL to caption');

  const [frames, transcript] = await Promise.all([
    Promise.resolve(frameUrls(videoUrl, { durationSec })),
    transcribeAudio(videoUrl),
  ]);

  const userText =
    (brief?.trim() ? `${brief.trim()}\n\n` : '') +
    (transcript ? `Transcript of the audio:\n"""${transcript.slice(0, 2000)}"""\n\n` : '') +
    `Write the caption from what you see across these frames${transcript ? ' and hear in the transcript' : ''}. Make the hook specific to this exact reel.`;

  const body = {
    model: VISION_MODEL,
    max_tokens: 280,
    temperature: 0.9,
    messages: [
      { role: 'system', content: systemPrompt(client, transcript) },
      { role: 'user', content: [{ type: 'text', text: userText }, ...frames.map((url) => ({ type: 'image_url', image_url: { url } }))] },
    ],
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Vision caption failed: ${JSON.stringify(d?.error || d).slice(0, 200)}`);
  return capHashtags((d.choices?.[0]?.message?.content || '').trim(), MAX_HASHTAGS);
}

// Primary + alternatives (for the manual "Generate" button so the user can pick).
export async function captionOptions({ videoUrl, client, brief, durationSec = 0, count = 3 }) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const [frames, transcript] = await Promise.all([
    Promise.resolve(videoUrl ? frameUrls(videoUrl, { durationSec }) : []),
    videoUrl ? transcribeAudio(videoUrl) : Promise.resolve(''),
  ]);

  const sys =
    systemPrompt(client, transcript) +
    `\n\nReturn STRICT JSON only: {"captions": ["option 1", "option 2", "option 3"]} with ${count} distinct options ` +
    `(different hooks/angles), each already including its hashtags line.`;

  const userText =
    (brief?.trim() ? `${brief.trim()}\n\n` : '') +
    (transcript ? `Transcript:\n"""${transcript.slice(0, 2000)}"""\n\n` : '') +
    (frames.length ? `Base them on what you see + hear.` : `No video provided — write from the brand profile.`);

  const content = frames.length
    ? [{ type: 'text', text: userText }, ...frames.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : userText;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: VISION_MODEL, max_tokens: 700, temperature: 0.95, messages: [{ role: 'system', content: sys }, { role: 'user', content }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Caption options failed: ${JSON.stringify(d?.error || d).slice(0, 200)}`);
  const raw = (d.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
  let list = [];
  try { list = JSON.parse(raw).captions || []; } catch { list = [raw]; }
  list = list.map((c) => capHashtags(String(c).trim(), MAX_HASHTAGS)).filter(Boolean);
  return { caption: list[0] || '', alternatives: list.slice(1) };
}