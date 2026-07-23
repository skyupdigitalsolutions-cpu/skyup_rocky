// Deterministic offline LLM. It does NOT invent metrics — it only reflects the
// grounded context the orchestrator already assembled, so the whole app is
// testable without any API key while honoring PRD Section 9 grounding rules.
export async function mockChat({ system = '', messages = [] }) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  // Pull the CONTEXT block the orchestrator injected (between markers).
  const ctxMatch = system.match(/<CONTEXT>([\s\S]*?)<\/CONTEXT>/);
  const context = ctxMatch ? ctxMatch[1].trim() : '';

  // The prompt builder emits this exact sentence when nothing is grounded.
  const hasData = context.length > 0 && !/no connected or available data/i.test(context);

  let text;
  if (!hasData) {
    text =
      `I don't have connected data for that yet, so I won't guess.\n\n` +
      `To answer "${lastUser.slice(0, 140)}", I'd need one of: a connected Meta/Google Ads account, ` +
      `Search Console/GA4 access, or an uploaded client document. ` +
      `Connect a source on the Integrations page or upload a doc, then ask again.\n\n` +
      `_(mock LLM — set LLM_PROVIDER + an API key in .env for full analysis)_`;
  } else {
    text =
      `Here's what the connected data shows (mock synthesis):\n\n` +
      `${summarize(context)}\n\n` +
      `**Recommendation:** review the highlighted movements above before making changes; ` +
      `V1 will not modify any external system automatically.\n\n` +
      `_(mock LLM — deterministic summary of grounded context; no metrics invented. ` +
      `Set a real LLM_PROVIDER for full reasoning.)_`;
  }

  return {
    text,
    model: 'mock-1',
    usage: { inputTokens: system.length + lastUser.length, outputTokens: text.length },
  };
}

function summarize(context) {
  const lines = context
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  return lines.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n');
}
