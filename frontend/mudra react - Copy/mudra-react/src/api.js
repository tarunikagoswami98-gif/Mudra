// Module 4 client: queue words -> POST /sentence (server has LLM, 1.2 s budget, cache, fallback phrases).
// If the server is off or too slow, the caller shows the raw words instead, so nothing blocks.
const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
const CLIENT_TIMEOUT_MS = 2500; // server's own LLM budget is 1.2 s; this only guards against a dead server

export async function makeSentence(words) {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
  try {
    const r = await fetch(`${API}/sentence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: words, lang: "en" }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json(); // { sentence, source: llm|cache|fallback|raw, ms }
    return { sentence: d.sentence, source: d.source, ms: d.ms ?? Math.round(performance.now() - t0) };
  } catch {
    return null; // server unreachable or too slow -> caller uses raw words
  } finally {
    clearTimeout(timer);
  }
}

// Speech only runs when the user presses Speak (see App.jsx). Utterances queue, never overlap.
export function speak(text, lang, onEnd) {
  if (!("speechSynthesis" in window) || !text) { onEnd && onEnd(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "hi" ? "hi-IN" : "en-IN";
  u.onend = u.onerror = () => onEnd && onEnd();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
