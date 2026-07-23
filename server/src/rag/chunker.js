// Simple, dependency-free chunker: splits on paragraph boundaries then packs
// into ~maxChars windows with a small overlap. Good enough for V1; swap for a
// token-aware splitter later without changing callers.
export function chunkText(text, { maxChars = 1200, overlap = 150 } = {}) {
  const clean = String(text).replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const paras = clean.split(/\n{2,}/);
  const chunks = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };

  for (const p of paras) {
    if ((buf + '\n\n' + p).length > maxChars) {
      flush();
      // carry a little overlap for context continuity
      const tail = chunks.length ? chunks[chunks.length - 1].slice(-overlap) : '';
      buf = (tail ? tail + '\n\n' : '') + p;
      // very long single paragraph: hard-split
      while (buf.length > maxChars) {
        chunks.push(buf.slice(0, maxChars));
        buf = buf.slice(maxChars - overlap);
      }
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  flush();
  return chunks.map((text, order) => ({ text, order, tokens: Math.ceil(text.length / 4) }));
}
