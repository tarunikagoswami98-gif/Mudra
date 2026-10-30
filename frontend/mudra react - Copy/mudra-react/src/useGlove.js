import { useEffect, useRef, useState } from "react";
import { CUSTOM_GESTURES } from "./gestures.js";

const WS = import.meta.env.VITE_WS_URL || "";
const GESTURES = ["HELLO WATER", "HELP NEED", "THANK YOU", "HELLO", ...CUSTOM_GESTURES];
const rand = () => 10 + Math.floor(Math.random() * 85);

// Accepted messages from Module 3 (both work):
//  1) { type: "recognized_keywords", keywords: ["NEED", "WATER"] }   <- teammate's format
//  2) { type: "fallback_phrase", phrase: "I need water." }            <- ready sentence, shown directly
//  3) { gesture: "HELP", flex: [5 numbers], confidence: 0.98 }       <- old glove-packet format
const validPacket = (p) =>
  p && typeof p.gesture === "string" && Array.isArray(p.flex) && p.flex.length === 5 &&
  p.flex.every(Number.isFinite) && Number.isFinite(p.confidence);

export default function useGlove() {
  const [packet, setPacket] = useState({ gesture: "", flex: [12, 18, 16, 14, 11], confidence: 0 });
  const [history, setHistory] = useState([]);
  const [live, setLive] = useState(false);
  const [kw, setKw] = useState(null); // latest keywords message: { id, words }
  const [fb, setFb] = useState(null); // latest fallback phrase from Module 3: { id, phrase }
  const tick = useRef(0);
  const kwId = useRef(0);
  const fbId = useRef(0);

  const push = (p) => {
    setPacket(p);
    tick.current += 1;
    const avg = p.flex.reduce((a, b) => a + b, 0) / p.flex.length;
    setHistory((h) => [...h.slice(-39), { t: tick.current, v: Math.round(avg) }]);
  };

  const handle = (data) => {
    if (data && data.type === "recognized_keywords") {
      const list = Array.isArray(data.keywords) ? data.keywords : String(data.keywords || "").split(/\s+/);
      const words = list.map((w) => String(w).trim()).filter(Boolean);
      if (words.length) setKw({ id: ++kwId.current, words });
      return;
    }
    if (data && data.type === "fallback_phrase") {
      const phrase = String(data.phrase || "").trim();
      if (phrase) setFb({ id: ++fbId.current, phrase });
      return;
    }
    if (validPacket(data)) push(data); // bad packets are ignored, so the page never crashes
  };

  useEffect(() => {
    if (!WS) return;
    let ws, timer, closed = false;
    const connect = () => {
      ws = new WebSocket(WS);
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!closed) timer = setTimeout(connect, 2000); // auto-reconnect
      };
      ws.onmessage = (e) => {
        try { handle(JSON.parse(e.data)); } catch { /* ignore bad message */ }
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.close(); };
  }, []);

  // ~1 in 5 simulated readings is uncertain, so UNKNOWN handling can be demoed.
  const simulate = () => {
    const unsure = Math.random() < 0.2;
    push({
      gesture: unsure ? "UNKNOWN" : GESTURES[Math.floor(Math.random() * GESTURES.length)],
      flex: Array.from({ length: 5 }, rand),
      confidence: unsure ? 0.3 + Math.random() * 0.3 : 0.9 + Math.random() * 0.09,
    });
  };

  return { packet, history, live, simulate, kw, fb };
}
