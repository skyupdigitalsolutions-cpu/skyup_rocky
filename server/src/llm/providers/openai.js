import { env } from '../../config/env.js';

// OpenAI Chat Completions. Uses global fetch (Node 20+). No SDK dependency.
export async function openaiChat({ system = '', messages = [], temperature = 0.2, maxTokens = 1024 }) {
  const payload = {
    model: env.OPENAI_MODEL,
    temperature,
    max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || '',
    model: data.model,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}
