import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth, requirePermission(PERMISSIONS.CHAT_USE));

// Turn Rocky's grounded answer into natural speech via OpenAI TTS. We strip
// markdown first so the voice never reads out "asterisk asterisk" etc., and
// (on the gpt-4o-mini-tts model) pass tone instructions for a warm, human,
// conversational delivery rather than a flat reader.
const schema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
});

router.post(
  '/speak',
  asyncHandler(async (req, res) => {
    const { text, voice } = schema.parse(req.body);
    if (!env.OPENAI_API_KEY) throw new HttpError(400, 'OPENAI_API_KEY not set — voice needs it for TTS');

    const clean = stripMarkdown(text).slice(0, 4000);
    const model = env.OPENAI_TTS_MODEL;

    const body = {
      model,
      voice: voice || env.OPENAI_TTS_VOICE,
      input: clean,
      response_format: 'mp3',
    };
    // Only the gpt-4o-* speech models honor tone instructions.
    if (/gpt-4o/.test(model)) {
      body.instructions =
        'Speak like a sharp, friendly human colleague briefing a teammate. ' +
        'Warm, natural, conversational pacing with light intonation — not a robotic reader. ' +
        'Confident and clear, never sing-song.';
    }

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new HttpError(502, `TTS failed: ${r.status} ${errText.slice(0, 200)}`);
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  })
);

// Flatten markdown to clean spoken text.
function stripMarkdown(s) {
  return s
    .replace(/```[\s\S]*?```/g, ' code block omitted ') // fenced code
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*>\s?/gm, '') // quotes
    .replace(/^\s*[-*+]\s+/gm, '') // bullets
    .replace(/^\s*\d+\.\s+/gm, '') // numbered
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\|/g, ' ') // table pipes
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Speech-to-text via OpenAI Whisper. The browser records an audio segment and
// POSTs the raw bytes here; far more accurate than the browser recognizer,
// especially for accents and background noise.
router.post(
  '/transcribe',
  express.raw({ type: () => true, limit: '25mb' }),
  asyncHandler(async (req, res) => {
    if (!env.OPENAI_API_KEY) throw new HttpError(400, 'OPENAI_API_KEY not set — Whisper needs it');
    const buf = req.body;
    if (!buf || !buf.length) throw new HttpError(400, 'No audio received');

    const mime = req.headers['content-type'] || 'audio/webm';
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm';

    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), `audio.${ext}`);
    form.append('model', process.env.OPENAI_STT_MODEL || 'whisper-1');
    form.append('language', process.env.OPENAI_STT_LANGUAGE || 'en');
    form.append('response_format', 'json');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(502, `Transcription failed: ${JSON.stringify(d?.error || d).slice(0, 200)}`);
    res.json({ text: (d.text || '').trim() });
  })
);

export default router;