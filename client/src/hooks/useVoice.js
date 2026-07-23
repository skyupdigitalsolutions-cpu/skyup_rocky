import { useState, useRef, useCallback, useEffect } from 'react';

// Free, no-key voice via the browser Web Speech API.
//  - Speech-to-text: webkitSpeechRecognition / SpeechRecognition
//  - Text-to-speech: speechSynthesis
// This is intentionally isolated so it can be swapped for Whisper/Piper or a
// paid provider later without touching the chat UI (PRD Phase 5 / V1 enhancement).
export function useVoice({ onFinalTranscript } = {}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef(null);

  const sttSupported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const startListening = useCallback(() => {
    if (!sttSupported) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
      if (transcript) onFinalTranscript?.(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [sttSupported, onFinalTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback(
    (text) => {
      if (!ttsSupported || !text) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(stripMarkdown(text));
      u.lang = 'en-IN';
      u.rate = 1.02;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [ttsSupported]
  );

  const stopSpeaking = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch {} }, []);

  return { listening, speaking, sttSupported, ttsSupported, startListening, stopListening, speak, stopSpeaking };
}

function stripMarkdown(t) {
  return t.replace(/[#*_`>]/g, '').replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ');
}