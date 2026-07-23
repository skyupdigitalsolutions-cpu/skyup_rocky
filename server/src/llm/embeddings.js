import { env } from '../config/env.js';
import { sha256 } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

// Returns a vector of length env.EMBEDDINGS_DIM for a string.
export async function embed(text) {
  if (env.EMBEDDINGS_PROVIDER === 'openai' && env.OPENAI_API_KEY) {
    return openaiEmbed(text);
  }
  if (env.EMBEDDINGS_PROVIDER === 'openai') {
    logger.warn('[embeddings] provider=openai but no OPENAI_API_KEY — using mock embeddings');
  }
  return mockEmbed(text);
}

export async function embedMany(texts) {
  return Promise.all(texts.map((t) => embed(t)));
}

// Deterministic pseudo-embedding: hash-seeded unit vector. Not semantically
// meaningful, but stable + comparable so RAG plumbing is fully testable offline.
function mockEmbed(text) {
  const dim = env.EMBEDDINGS_DIM;
  const seed = sha256(text);
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) {
    const b = seed[i % seed.length];
    v[i] = (b / 255) * 2 - 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function openaiEmbed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.EMBEDDINGS_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

export const usingMockEmbeddings = () =>
  env.EMBEDDINGS_PROVIDER === 'mock' || !env.OPENAI_API_KEY;
