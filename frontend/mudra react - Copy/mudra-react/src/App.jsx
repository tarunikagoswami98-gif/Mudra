import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import useGlove from "./useGlove.js";
import { makeSentence, speak, stopSpeaking } from "./api.js";
import { BASE_GESTURES, CUSTOM_GESTURES, CUSTOM_LIMIT, EMERGENCY_PHRASES } from "./gestures.js";

const FINGERS = ["T", "I", "M", "R", "P"];
const MIN_CONFIDENCE = 0.75; // below this the reading is treated as UNKNOWN
const REPEAT_MS = 1500;      // same gesture held longer than this is not added twice

let nextId = 1;

export default function App() {
  const { packet, history, live, simulate, kw, fb } = useGlove();
  const [theme, setTheme] = useState("dark");
  const [tab, setTab] = useState("main"); // main | custom | emergency
  // Custom gestures written by the user: [{ id, label, phrase }]. Saved in the browser so they survive a refresh.
  const [customs, setCustoms] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mudra.customs"));
      if (Array.isArray(saved)) return saved;
    } catch { /* ignore */ }
    return CUSTOM_GESTURES.map((label, i) => ({ id: `c${Date.now()}-${i}`, label, phrase: "" }));
  });
  const [cName, setCName] = useState("");
  const [cPhrase, setCPhrase] = useState("");
  const [queue, setQueue] = useState([]);    // phrase queue: [{id, word}]
  const [label, setLabel] = useState("");    // last recognition: a word or "UNKNOWN"
  const [typed, setTyped] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [useLLM, setUseLLM] = useState(true);  // Off = show the raw words (safe mode if Ollama is down)
  const [sentence, setSentence] = useState(null); // { sentence, source, ms } from Module 4
  const [busy, setBusy] = useState(false);
  const [direct, setDirect] = useState(""); // ready sentence sent by Module 3 (fallback_phrase): shown as is, no Module 4
  const [log, setLog] = useState([]);        // phrases already spoken
  const last = useRef({ word: "", t: 0 });
  const speakToken = useRef(0); // so a cancelled phrase cannot mark a newer one as finished

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const addWord = (word) => {
    const w = word.trim().toUpperCase();
    if (!w) return;
    setDirect(""); // a new word replaces any phrase sent directly by Module 3
    setQueue((q) => [...q, { id: nextId++, word: w }]);
  };

  // Every glove reading: UNKNOWN or low confidence -> show UNKNOWN, add nothing.
  useEffect(() => {
    const g = (packet.gesture || "").toUpperCase();
    if (!g) return;
    if (g === "UNKNOWN" || packet.confidence < MIN_CONFIDENCE) {
      setLabel("UNKNOWN");
      return;
    }
    setLabel(g);
    const now = Date.now();
    if (g === last.current.word && now - last.current.t < REPEAT_MS) return;
    last.current = { word: g, t: now };
    addWord(g);
  }, [packet]);

  // Module 3 "recognized_keywords" message: add each keyword to the phrase queue.
  useEffect(() => {
    if (!kw) return;
    kw.words.forEach((w) => addWord(w));
  }, [kw]);

  // Module 3 "fallback_phrase" message: show the ready sentence as is (Module 4 is not used).
  useEffect(() => {
    if (!fb) return;
    setQueue([]);
    setDirect(fb.phrase);
  }, [fb]);

  useEffect(() => {
    try { localStorage.setItem("mudra.customs", JSON.stringify(customs)); } catch { /* ignore */ }
  }, [customs]);

  const addCustom = () => {
    const label = cName.trim().toUpperCase();
    if (!label || customs.length >= CUSTOM_LIMIT || customs.some((c) => c.label === label)) return;
    setCustoms((c) => [...c, { id: `c${Date.now()}`, label, phrase: cPhrase.trim() }]);
    setCName("");
    setCPhrase("");
  };

  const words = queue.map((q) => q.word);
  const rawText = words.join(" ").toLowerCase();

  // Module 4: turn the queued words into a sentence for review. Never spoken until Speak is pressed.
  useEffect(() => {
    setSentence(null); // queue changed: old sentence is stale, show raw words meanwhile
    if (!useLLM || !words.length) { setBusy(false); return; }
    let stale = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      const r = await makeSentence(words);
      if (!stale) { setSentence(r); setBusy(false); }
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
  }, [queue, useLLM]);

  const shown = direct
    ? direct
    : !words.length
    ? "Make a sign to begin"
    : useLLM && sentence ? sentence.sentence : rawText;

  const onSpeak = () => {
    if ((!words.length && !direct) || speaking) return;
    const tok = ++speakToken.current;
    setSpeaking(true);
    speak(shown, "en", () => { if (speakToken.current === tok) setSpeaking(false); });
    setLog((l) => [shown, ...l].slice(0, 3));
    setQueue([]); // Speak ends the phrase; next gesture starts a new one
    setSentence(null);
    setDirect("");
  };

  const onStop = () => { speakToken.current++; stopSpeaking(); setSpeaking(false); };

  // Emergency button: speaks immediately, interrupting anything else. Does not touch the phrase queue.
  const onEmergency = (phrase) => {
    stopSpeaking();
    const tok = ++speakToken.current;
    setSpeaking(true);
    speak(phrase, "en", () => { if (speakToken.current === tok) setSpeaking(false); });
    setLog((l) => [phrase, ...l].slice(0, 3));
  };

  return (
    <>
      <header>
        <div className="logo"><i /> MUDRA</div>
        <div className="status"><b>■</b> Core online / {live ? "Live" : "Demo mode"}</div>
        <div className="ctrl">
          <button className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      <main>
        <aside>
          <section className="card">
            <h3><span>01 Input telemetry</span><b>115200 baud</b></h3>
            <div className="body">
              <pre>{JSON.stringify({ gesture: packet.gesture || "NONE", flex: packet.flex, confidence: +packet.confidence.toFixed(3) }, null, 2)}</pre>
              <div className="bars">
                {packet.flex.map((v, i) => (
                  <div key={i} className="bar" style={{ height: `${Math.max(4, v)}%` }}>
                    <span>{FINGERS[i]}</span>
                  </div>
                ))}
              </div>
              <button className="btn" style={{ marginTop: 26 }} onClick={simulate}>Pulse (simulate glove)</button>
            </div>
          </section>

          <section className="card">
            <h3><span>02 Signal map</span><b>{history.length ? "Live" : "Idle"}</b></h3>
            <div className="body" style={{ height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <YAxis domain={[0, 100]} hide />
                  <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h3><span>03 Recognition</span><b>{label || "Ready"}</b></h3>
            <div className="body">
              <pre>
                {label === "UNKNOWN"
                  ? "UNKNOWN: no word added"
                  : label ? `accepted: ${label}` : "Waiting for gesture…"}
                {useLLM && words.length
                  ? sentence ? `\nsentence: ${sentence.source}\nlatency: ${sentence.ms} ms` : busy ? "\nsentence: writing…" : "\nsentence: server off, raw words"
                  : ""}
              </pre>
            </div>
          </section>
        </aside>

        <section className="stage">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "main"} className={`tab ${tab === "main" ? "active" : ""}`} onClick={() => setTab("main")}>
              Main{queue.length ? ` (${queue.length})` : ""}
            </button>
            <button role="tab" aria-selected={tab === "custom"} className={`tab ${tab === "custom" ? "active" : ""}`} onClick={() => setTab("custom")}>Custom gestures</button>
            <button role="tab" aria-selected={tab === "emergency"} className={`tab ${tab === "emergency" ? "active" : ""}`} onClick={() => setTab("emergency")}>Emergency</button>
          </div>

          {tab === "main" && (
            <>
          <div className="eyebrow">
            <span>Phrase queue / review before speaking</span>
            <span className={`badge ${label === "UNKNOWN" ? "warn" : ""}`}>
              {label === "UNKNOWN" ? "UNKNOWN" : `${(packet.confidence * 100 || 0).toFixed(1)}% match`}
            </span>
          </div>

          <div className="queue" aria-label="Phrase queue">
            {queue.length === 0 && <span className="muted">Queue is empty</span>}
            {queue.map((q) => (
              <button key={q.id} className="chip word" title="Remove this word" onClick={() => setQueue((x) => x.filter((i) => i.id !== q.id))}>
                {q.word} ×
              </button>
            ))}
          </div>

          <p className="big" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.span key={shown} style={{ display: "inline" }}>
                {shown.split(" ").map((w, i) => (
                  <motion.span key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.25 }} style={{ display: "inline-block", marginRight: "0.28em" }}>
                    {w}
                  </motion.span>
                ))}
              </motion.span>
            </AnimatePresence>
          </p>

          <div className="row">
            <button className="btn solid" disabled={(!words.length && !direct) || speaking || busy} onClick={onSpeak}>
              {speaking ? "Speaking…" : busy ? "Writing…" : "Speak"}
            </button>
            <button className="btn" disabled={!speaking} onClick={onStop}>Stop</button>
            <button className="btn" disabled={!words.length && !direct} onClick={() => { setQueue([]); setDirect(""); }}>Clear</button>
            <button className={`btn ${useLLM ? "on" : ""}`} aria-pressed={useLLM} onClick={() => setUseLLM(!useLLM)} title="Turn LLM sentence on or off">
              Sentence: {useLLM ? "On" : "Off"}
            </button>
            <button className="btn" disabled={!words.length} onClick={() => setQueue((q) => q.slice(0, -1))}>Undo word</button>
          </div>

          <div className="row">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addWord(typed); setTyped(""); } }} placeholder="Type a word (testing without glove)" aria-label="Add word manually" />
            <button className="btn" onClick={() => { addWord(typed); setTyped(""); }}>Add</button>
          </div>
          <div className="chips">
            {BASE_GESTURES.map((c) => (
              <button key={c} className="chip" onClick={() => addWord(c)}>{c}</button>
            ))}
          </div>
          {log.length > 0 && (
            <section className="card" style={{ marginTop: 16 }}>
              <h3><span>Spoken phrases</span></h3>
              <div className="body">{log.map((l, i) => <div key={i} className="muted">{l}</div>)}</div>
            </section>
          )}
            </>
          )}

          {tab === "custom" && (
            <>
              <div className="eyebrow">
                <span>Custom gestures</span>
                <span>Slots used {customs.length} / {CUSTOM_LIMIT}</span>
              </div>
              <p className="muted" style={{ margin: "10px 0 16px" }}>
                Write your own gesture name and, if you want, a fixed sentence. Add to queue sends the name to the Main tab. Speak says the fixed sentence at once.
              </p>

              {customs.length === 0 && <p className="muted">No custom gestures yet. Add one below.</p>}
              {customs.map((c, n) => (
                <div key={c.id} className="slot">
                  <span className="n">{n + 1}</span>
                  <div className="info">
                    <b>{c.label}</b>
                    <span className="muted">{c.phrase ? `says: ${c.phrase}` : "sentence made by the LLM"}</span>
                  </div>
                  <button className="btn" onClick={() => addWord(c.label)}>Add to queue</button>
                  {c.phrase && <button className="btn" onClick={() => onEmergency(c.phrase)}>Speak</button>}
                  <button className="btn" title="Remove" aria-label={`Remove ${c.label}`} onClick={() => setCustoms((x) => x.filter((i) => i.id !== c.id))}>×</button>
                </div>
              ))}

              <div className="row" style={{ marginTop: 18 }}>
                <input value={cName} onChange={(e) => setCName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()} placeholder="Gesture name (e.g. CHAI)" aria-label="Custom gesture name" disabled={customs.length >= CUSTOM_LIMIT} />
                <input value={cPhrase} onChange={(e) => setCPhrase(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()} placeholder="Fixed sentence (optional)" aria-label="Fixed sentence" disabled={customs.length >= CUSTOM_LIMIT} style={{ textTransform: "none" }} />
                <button className="btn solid" onClick={addCustom} disabled={!cName.trim() || customs.length >= CUSTOM_LIMIT}>Add</button>
              </div>
              {customs.length >= CUSTOM_LIMIT && <p className="muted">All {CUSTOM_LIMIT} slots are used. Remove one to add another.</p>}
            </>
          )}

          {tab === "emergency" && (
            <>
              <div className="eyebrow"><span>Emergency</span><span>Speaks immediately</span></div>
              <div className="emerg-grid" style={{ marginTop: 16 }}>
                {EMERGENCY_PHRASES.map((e) => (
                  <button key={e.label} className="emerg-card" onClick={() => onEmergency(e.phrase)}>
                    <b>{e.label}</b>
                    <span>{e.phrase}</span>
                  </button>
                ))}
              </div>
              {speaking && <p className="muted" style={{ marginTop: 14 }}>Speaking…</p>}
            </>
          )}
        </section>
      </main>
    </>
  );
}
