import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { mockChat } from './providers/mock.js';
import { anthropicChat } from './providers/anthropic.js';
import { openaiChat } from './providers/openai.js';

// Single interface the orchestrator talks to. Each provider implements:
//   chat({ system, messages, temperature, maxTokens }) -> { text, model, usage }
// where messages = [{ role: 'user'|'assistant', content: string }].
const PROVIDERS = {
  mock: mockChat,
  anthropic: anthropicChat,
  openai: openaiChat,
};

export async function llmChat(opts) {
  const provider = PROVIDERS[env.LLM_PROVIDER];
  if (!provider) throw new Error(`Unknown LLM_PROVIDER: ${env.LLM_PROVIDER}`);

  // Guard: if a real provider is selected but no key is present, fall back to
  // mock so the app never hard-crashes — and log loudly.
  if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    logger.warn('[llm] LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty — using mock');
    return mockChat(opts);
  }
  if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
    logger.warn('[llm] LLM_PROVIDER=openai but OPENAI_API_KEY is empty — using mock');
    return mockChat(opts);
  }

  return provider(opts);
}

export const usingMockLLM = () =>
  env.LLM_PROVIDER === 'mock' ||
  (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) ||
  (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY);
