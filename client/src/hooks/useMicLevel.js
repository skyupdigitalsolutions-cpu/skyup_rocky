import { useCallback, useEffect, useRef, useState } from 'react';

// Taps the microphone via Web Audio and streams a normalized frequency
// spectrum every animation frame. useVoice handles speech-to-text; this runs
// alongside it purely to drive the reactive core in the Command Center.
//
// Usage:
//   const bands = useRef(new Float32Array(64));
//   const mic = useMicLevel({ bins: 64, onFrame: (b, level) => { bands.current = b; } });
//   mic.start(); // begins streaming; mic.stop() releases the mic.
export function useMicLevel({ bins = 64, smoothing = 0.75, onFrame } = {}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(0);
  const dataRef = useRef(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { ctxRef.current?.close(); } catch {}
    streamRef.current = null;
    ctxRef.current = null;
    analyserRef.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = smoothing;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      setActive(true);

      const loop = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteFrequencyData(dataRef.current);
        const raw = dataRef.current;
        // Down-sample the FFT bins into `bins` bands, normalized 0..1.
        const out = new Float32Array(bins);
        const step = Math.floor(raw.length / bins) || 1;
        let level = 0;
        for (let i = 0; i < bins; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += raw[i * step + j] || 0;
          const v = sum / step / 255;
          out[i] = v;
          level += v;
        }
        level = level / bins;
        onFrame?.(out, level);
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      setError(e?.message || 'Microphone access denied');
      setActive(false);
    }
  }, [bins, smoothing, onFrame]);

  useEffect(() => () => stop(), [stop]);

  return { active, error, start, stop };
}
