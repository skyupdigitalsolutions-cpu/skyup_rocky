import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

// Always-on hands-free listening via OpenAI Whisper (far better than the
// browser recognizer). Records one utterance at a time using MediaRecorder,
// detects end-of-speech with a simple RMS silence gate, POSTs the audio to
// /voice/transcribe, emits the text, then loops. Call stop() while Rocky is
// speaking so it never transcribes its own voice.
export function useWhisperListen({ onTranscript, onError, silenceMs = 1100, minSpeechMs = 300, maxSegmentMs = 15000 } = {}) {
  const [listening, setListening] = useState(false);
  const activeRef = useRef(false);
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const recRef = useRef(null);
  const rafRef = useRef(0);
  const capTimerRef = useRef(null);
  const wasListeningRef = useRef(false);

  const supported =
    typeof window !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined';

  const pickMime = () => {
    const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return opts.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
  };

  const stop = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    clearTimeout(capTimerRef.current);
    try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { ctxRef.current?.close(); } catch {}
    streamRef.current = null; ctxRef.current = null; analyserRef.current = null; recRef.current = null;
    setListening(false);
  }, []);

  // One record-until-silence segment, then transcribe and loop.
  const cycle = useCallback(() => {
    if (!activeRef.current || !streamRef.current || !analyserRef.current) return;
    const mime = pickMime();
    let rec;
    try { rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined); }
    catch (e) { onError?.(e.message || 'recorder error'); return; }
    recRef.current = rec;

    const chunks = [];
    let hasSpeech = false, speechStart = 0, lastLoud = 0;
    const started = Date.now();

    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(capTimerRef.current);
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      if (activeRef.current && hasSpeech && blob.size > 2000) {
        try {
          const { data } = await api.post('/voice/transcribe', blob, {
            headers: { 'Content-Type': blob.type || 'audio/webm' },
          });
          const text = (data.text || '').trim();
          if (text) onTranscript?.(text);
        } catch (e) { onError?.(e?.response?.data?.error?.message || e?.message || 'transcribe error'); }
      }
      if (activeRef.current) cycle(); // next utterance
    };

    try { rec.start(100); } catch (e) { onError?.(e.message || 'recorder start error'); return; }

    // Background-safe hard stop: requestAnimationFrame is throttled/paused when
    // the tab is not focused, so we ALSO cap the segment with a timer that keeps
    // firing in the background. Without this, a backgrounded tab records until
    // it regains focus (a single clip could run minutes long).
    clearTimeout(capTimerRef.current);
    capTimerRef.current = setTimeout(() => { try { if (rec.state !== 'inactive') rec.stop(); } catch {} }, maxSegmentMs);

    const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
    const tick = () => {
      if (!activeRef.current || !recRef.current || recRef.current.state === 'inactive') return;
      analyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (rms > 0.025) { if (!hasSpeech) { hasSpeech = true; speechStart = now; } lastLoud = now; }
      const hardCap = now - started > maxSegmentMs;
      const doneSpeaking = hasSpeech && now - lastLoud > silenceMs && lastLoud - speechStart > minSpeechMs;
      if (doneSpeaking || hardCap) { try { rec.stop(); } catch {} return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [onTranscript, onError, silenceMs, minSpeechMs, maxSegmentMs]);

  const start = useCallback(async () => {
    if (activeRef.current || !supported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx(); ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); analyserRef.current = an;
      activeRef.current = true; setListening(true);
      cycle();
    } catch (e) {
      onError?.(e.message || 'microphone access denied');
      setListening(false);
    }
  }, [supported, cycle, onError]);

  // Pause listening while the tab is hidden so the mic never records in the
  // background (and resume when the user returns).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && activeRef.current) {
        wasListeningRef.current = true;
        stop();
      } else if (document.visibilityState === 'visible' && wasListeningRef.current) {
        wasListeningRef.current = false;
        start();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [stop, start]);

  useEffect(() => () => stop(), [stop]);

  return { listening, start, stop, supported };
}