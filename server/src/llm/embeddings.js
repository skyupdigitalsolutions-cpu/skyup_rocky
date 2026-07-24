import { env } from '../config/env.js';

// OpenAI embeddings ONLY. No mock/hash fallback: mock vectors aren't
// semantically meaningful, and silently using them makes RAG retrieval random —
// worse the larger the knowledge base. We fail LOUDLY instead of degrading.

const BATCH_SIZE = 96; // OpenAI accepts many inputs per request

function assertConfigured() {
  if (env.EMBEDDINGS_PROVIDER !== 'openai') {
    throw new Error(`[embeddings] EMBEDDINGS_PROVIDER must be "openai" (got "${env.EMBEDDINGS_PROVIDER}"). Mock embeddings are disabled.`);
  }
  if (!env.OPENAI_API_KEY) {
    throw new Error('[embeddings] OPENAI_API_KEY is missing. Set it in .env — RAG cannot run without real embeddings.');
  }
}

export function embeddingsReady() {
  return env.EMBEDDINGS_PROVIDER === 'openai' && Boolean(env.OPENAI_API_KEY);
}

// Single-string embedding.
export async function embed(text) {
  assertConfigured();
  const [v] = await openaiEmbedBatch([text]);
  return v;
}

// Batched embedding — chunks the array into BATCH_SIZE requests (fast + fewer
// API calls for large-scale ingestion). Returns vectors in input order.
export async function embedMany(texts) {
  assertConfigured();
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vecs = await openaiEmbedBatch(batch);
    out.push(...vecs);
  }
  return out;
}

async function openaiEmbedBatch(inputs) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.EMBEDDINGS_MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Sort by index so order matches inputs regardless of API ordering.
  return data.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// Boot-time verification: confirms the key works, the provider is OpenAI, and —
// critically — that the model's real output dimension matches EMBEDDINGS_DIM.
// Throws a clear, actionable error otherwise.
export async function verifyEmbeddings() {
  assertConfigured();
  const v = await openaiEmbedBatch(['ping']);
  const dim = v[0]?.length || 0;
  if (dim !== env.EMBEDDINGS_DIM) {
    throw new Error(
      `[embeddings] DIM MISMATCH: model "${env.EMBEDDINGS_MODEL}" returns ${dim} dims but EMBEDDINGS_DIM=${env.EMBEDDINGS_DIM}. ` +
      `Set EMBEDDINGS_DIM=${dim} in .env (and re-embed if you changed models).`
    );
  }
  return { ok: true, model: env.EMBEDDINGS_MODEL, dim };
}

export const usingMockEmbeddings = () => !embeddingsReady();