import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiError } from '../api/client.js';
import { useAuth } from '../store/auth.jsx';
import { useVoice } from '../hooks/useVoice.js';
import { useWhisperListen } from '../hooks/useWhisperListen.js';
import { useMicLevel } from '../hooks/useMicLevel.js';
import ActivityFeed from '../components/ActivityFeed.jsx';
import '../styles/command.css';

const BARS = 72;
const RADIUS = 138;

// Wake phrase — forgiving of how Chrome mis-hears "Rocky".
const WAKE = /\b(hey|hi|ok|okay|a)\s+(rock(y|ie|i|ey)?|rocci|rockey|rocket)\b/i;
const STEP_ICON = { listen: '🎧', heard: '🗣️', think: '🧠', act: '📅', done: '✅', error: '⚠️' };

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.05;
    o.start(); o.stop(ctx.currentTime + 0.12);
    setTimeout(() => ctx.close(), 300);
  } catch { /* noop */ }
}

function RockyMark({ size = 130 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="21" stroke="var(--hud)" strokeWidth="1" opacity="0.5" />
      <circle cx="24" cy="24" r="15" stroke="var(--hud)" strokeWidth="1.6" />
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1="24" y1="3" x2="24" y2="8" stroke="var(--hud)" strokeWidth="1.6" transform={`rotate(${a} 24 24)`} />
      ))}
      <path d="M18 32V16h7a4 4 0 0 1 0 8h-4m4 0 5 8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28 20l6-6m0 0h-4m4 0v4" stroke="var(--hud-bright)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReactiveCore({ activeRef, bandsRef, status }) {
  const barRefs = useRef([]);
  const state = useRef({ cur: new Float32Array(BARS), t: 0, raf: 0 });
  const [live, setLive] = useState(false);

  const bars = useMemo(
    () => Array.from({ length: BARS }).map((_, i) => ({ style: { transform: `rotate(${(360 / BARS) * i}deg) translateY(-${RADIUS}px)` } })),
    []
  );

  useEffect(() => {
    const s = state.current;
    const half = BARS / 2;
    const loop = () => {
      const active = activeRef.current;
      const bands = bandsRef.current;
      for (let i = 0; i < BARS; i++) {
        let target;
        if (active && bands && bands.length) {
          const idx = i < half ? i : BARS - 1 - i;
          const b = Math.floor((idx / half) * bands.length);
          target = 0.35 + (bands[b] || 0) * 4.2;
        } else {
          target = 0.5 + 0.32 * Math.sin(s.t * 1.6 + i * 0.34) + 0.12 * Math.sin(s.t * 4 + i);
        }
        s.cur[i] += (target - s.cur[i]) * 0.28;
        const el = barRefs.current[i];
        if (el) {
          el.style.transform = `scaleY(${Math.max(0.2, s.cur[i])})`;
          el.style.opacity = String(0.45 + Math.min(s.cur[i], 2.2) * 0.25);
        }
      }
      s.t += 0.016;
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(s.raf);
  }, [activeRef, bandsRef]);

  useEffect(() => {
    const id = setInterval(() => setLive(activeRef.current), 150);
    return () => clearInterval(id);
  }, [activeRef]);

  return (
    <div className="core-stage">
      <svg className="core-ring r1" viewBox="0 0 400 400">
        <circle cx="200" cy="200" r="190" strokeDasharray="2 8" />
        {Array.from({ length: 60 }).map((_, i) => (
          <line key={i} x1="200" y1="16" x2="200" y2={i % 5 === 0 ? 30 : 24} transform={`rotate(${i * 6} 200 200)`} />
        ))}
      </svg>
      <svg className="core-ring r2" viewBox="0 0 400 400">
        <circle cx="200" cy="200" r="164" strokeDasharray="40 20" strokeWidth="1.5" />
      </svg>
      <svg className="core-ring r3" viewBox="0 0 400 400">
        <circle cx="200" cy="200" r="120" strokeDasharray="2 6" />
        <path d="M60 200 A140 140 0 0 1 120 90" strokeWidth="2" />
        <path d="M340 200 A140 140 0 0 1 280 310" strokeWidth="2" />
      </svg>

      <div className="core-bars">
        {bars.map((b, i) => (
          <div className="core-bar" key={i} style={b.style}>
            <span ref={(el) => (barRefs.current[i] = el)} />
          </div>
        ))}
      </div>

      <div className="core-glow" />
      <div className={`core-logo ${live ? 'live' : ''}`}>
        <RockyMark size={128} />
      </div>

      {status && <div className="core-status">{status}</div>}
    </div>
  );
}

const Icon = ({ d, ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d={d} />
  </svg>
);
function Delta({ v }) {
  const up = v >= 0;
  return (
    <span className={`cc-delta ${up ? 'up' : 'down'}`}>
      <Icon d={up ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} width="12" height="12" />{Math.abs(v)}%
    </span>
  );
}
function Sparkline({ color = 'var(--hud)', seed = 1 }) {
  const pts = useMemo(() => {
    let y = 30;
    return Array.from({ length: 24 }).map((_, i) => {
      y += (Math.sin(i * 0.7 + seed) + (Math.random() - 0.35)) * 5; y = Math.max(6, Math.min(38, y));
      return `${(i / 23) * 100},${y}`;
    }).join(' ');
  }, [seed]);
  return (
    <svg className="cc-spark" viewBox="0 0 100 44" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" />
      <polyline points={`0,44 ${pts} 100,44`} fill={color} opacity="0.08" stroke="none" />
    </svg>
  );
}
function Gauge({ value = 82 }) {
  const r = 62, c = 2 * Math.PI * r, off = c * (1 - value / 100);
  return (
    <svg className="cc-gauge" width="170" height="170" viewBox="0 0 170 170">
      <circle cx="85" cy="85" r={r} stroke="rgba(255,56,70,0.15)" strokeWidth="10" fill="none" />
      <circle cx="85" cy="85" r={r} stroke="var(--hud)" strokeWidth="10" fill="none" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 85 85)"
        style={{ filter: 'drop-shadow(0 0 8px var(--hud-glow))', transition: 'stroke-dashoffset 1s ease' }} />
      <text x="85" y="82" textAnchor="middle" className="cap">{value}%</text>
      <text x="85" y="102" textAnchor="middle" className="lab">HEALTHY</text>
    </svg>
  );
}
function Donut() {
  const segs = [
    { v: 35, c: 'var(--hud)', label: 'New', n: 58 }, { v: 33, c: 'var(--amber)', label: 'Contacted', n: 55 },
    { v: 19, c: '#4f9cf9', label: 'Qualified', n: 32 }, { v: 13, c: 'var(--green)', label: 'Closed', n: 20 },
  ];
  const r = 46, c = 2 * Math.PI * r; let acc = 0;
  return (
    <div className="cc-donut-wrap">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,0.06)" strokeWidth="14" fill="none" />
        {segs.map((s, i) => {
          const dash = (s.v / 100) * c;
          const el = <circle key={i} cx="60" cy="60" r={r} stroke={s.c} strokeWidth="14" fill="none"
            strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />;
          acc += dash; return el;
        })}
        <text x="60" y="57" textAnchor="middle" fill="#fff" style={{ font: '700 20px var(--display)' }}>165</text>
        <text x="60" y="73" textAnchor="middle" fill="var(--muted)" style={{ font: '600 8px var(--ui)', letterSpacing: '1px' }}>TOTAL LEADS</text>
      </svg>
      <div className="cc-legend">
        {segs.map((s) => <div className="li" key={s.label}><i style={{ background: s.c }} />{s.label} <b>{s.n} ({s.v}%)</b></div>)}
      </div>
    </div>
  );
}

const STATUS = { idle: 'Tap the mic or turn on Hey Rocky', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Rocky is speaking…' };

export default function CommandCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [brief, setBrief] = useState(null);
  const [insights, setInsights] = useState([]);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('idle');
  const [err, setErr] = useState('');

  // NEW: hands-free wake word + live process trail
  const [wakeOn, setWakeOn] = useState(false);
  const [steps, setSteps] = useState([]);
  const [lastAction, setLastAction] = useState(null);
  const wakeRef = useRef(false);       // hands-free wake mode active
  const activatedRef = useRef(false);  // heard "Hey Rocky", awaiting the command

  const activeRef = useRef(false);
  const bandsRef = useRef(new Float32Array(64));
  const sessionRef = useRef(false);
  const processingRef = useRef(false);
  const modeRef = useRef('idle');
  const convIdRef = useRef(null);
  const audioRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const outRafRef = useRef(0);
  const handleRef = useRef(() => {});

  const mic = useMicLevel({ bins: 64, onFrame: (b) => { bandsRef.current = b; } });
  const voice = useVoice({ onFinalTranscript: (t) => handleRef.current(t) });
  const whisper = useWhisperListen({ onTranscript: (t) => handleRef.current(t), onError: (m) => setErr(m) });

  const pushStep = useCallback((kind, text) => {
    setSteps((s) => [...s.slice(-5), { kind, text, id: Date.now() + Math.random() }]);
  }, []);

  function setModeSafe(m) {
    modeRef.current = m;
    activeRef.current = m === 'speaking';
    setMode(m);
  }

  useEffect(() => {
    (async () => {
      const [c, b, i] = await Promise.allSettled([api.get('/clients'), api.get('/briefs/today'), api.get('/insights')]);
      if (c.status === 'fulfilled') setClients(c.value.data.clients || c.value.data || []);
      if (b.status === 'fulfilled') setBrief(b.value.data.brief || b.value.data || null);
      if (i.status === 'fulfilled') setInsights(i.value.data.insights || i.value.data || []);
    })();
    return () => stopEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always-on hands-free: start listening automatically, no button needed.
  useEffect(() => {
    const begin = () => {
      if (sessionRef.current) return;
      sessionRef.current = true;
      wakeRef.current = false;      // no wake word — speak directly
      activatedRef.current = false;
      setModeSafe('listening');
      whisper.start();
    };
    const t = setTimeout(begin, 700);
    const onGesture = () => begin();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', onGesture); window.removeEventListener('keydown', onGesture); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep recognition alive during a listening session (covers wake mode too).
  useEffect(() => {
    if (!whisper.listening && sessionRef.current && modeRef.current === 'listening' && !processingRef.current) {
      const id = setTimeout(() => {
        if (sessionRef.current && modeRef.current === 'listening' && !processingRef.current) {
          whisper.start();
        }
      }, 400);
      return () => clearTimeout(id);
    }
  }, [whisper.listening]);

  function ensureAudio() {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audioRef.current = audio;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const src = ctx.createMediaElementSource(audio);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an); an.connect(ctx.destination);
        ctxRef.current = ctx; analyserRef.current = an;
      } catch { /* analysis optional; audio still plays */ }
    }
    return audioRef.current;
  }

  function startOutAnalysis() {
    const an = analyserRef.current;
    if (!an) return;
    const data = new Uint8Array(an.frequencyBinCount);
    const bins = 64, step = Math.floor(data.length / bins) || 1;
    const loop = () => {
      an.getByteFrequencyData(data);
      const out = new Float32Array(bins);
      for (let i = 0; i < bins; i++) {
        let sum = 0; for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
        out[i] = sum / step / 255;
      }
      bandsRef.current = out;
      outRafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }
  function stopOutAnalysis() { cancelAnimationFrame(outRafRef.current); }

  async function ask(text) {
    let id = convIdRef.current;
    if (!id) {
      const { data } = await api.post('/chat/conversations', { context: {} });
      id = data.conversation?._id || data.conversation?.id;
      convIdRef.current = id;
    }
    const { data } = await api.post(`/chat/conversations/${id}/messages`, { content: text });
    return { answer: data.message?.content || '', action: data.action || null };
  }

  async function speakAndWait(text) {
    const resp = await api.post('/voice/speak', { text, voice: 'onyx' }, { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data);
    const audio = ensureAudio();
    startOutAnalysis();
    audio.src = url;
    try { await ctxRef.current?.resume(); } catch {}
    try { await audio.play(); } catch {}
    await new Promise((resolve) => {
      const done = () => { audio.removeEventListener('ended', done); audio.removeEventListener('error', done); resolve(); };
      audio.addEventListener('ended', done);
      audio.addEventListener('error', done);
    });
    stopOutAnalysis();
    URL.revokeObjectURL(url);
  }

  async function handleTranscript(text) {
    const raw = (text || '').trim();
    if (!sessionRef.current || processingRef.current || !raw) return;
    if (!wakeRef.current && raw.split(/\s+/).length < 2) return; // ignore stray one-word noise

    // Wake-word gating — only when in hands-free wake mode.
    let query = raw;
    if (wakeRef.current) {
      if (!activatedRef.current) {
        const m = raw.match(WAKE);
        if (!m) return; // ignore ambient chatter until the wake word
        const after = raw.slice(m.index + m[0].length).trim().replace(/^[,.\s]+/, '');
        if (after.length > 2) {
          query = after; // command spoken in the same breath
        } else {
          activatedRef.current = true; // "Hey Rocky" alone — wait for the command
          pushStep('listen', "Yes? I'm listening…");
          beep();
          return;
        }
      } else {
        activatedRef.current = false;
        query = raw;
      }
    }

    processingRef.current = true;
    setErr('');
    setQ(query);
    setLastAction(null);
    pushStep('heard', `Heard: "${query}"`);
    whisper.stop();
    setModeSafe('thinking');
    pushStep('think', 'Understanding your request…');
    if (/\b(schedule|post|publish|reel|upload|queue)\b/i.test(query)) pushStep('act', 'Creating the reel slot…');

    try {
      const { answer, action } = await ask(query);
      if (action?.type === 'schedule_reel') {
        setLastAction(action);
        pushStep('done', `Scheduled for ${action.clientName}`);
      } else {
        pushStep('done', 'Done');
      }
      if (!sessionRef.current) { processingRef.current = false; setModeSafe('idle'); return; }
      setModeSafe('speaking');
      await speakAndWait(answer || "I didn't get an answer for that.");
    } catch (e) {
      setErr(apiError(e));
      pushStep('error', apiError(e));
    } finally {
      processingRef.current = false;
      activatedRef.current = false;
      if (sessionRef.current) { setModeSafe('listening'); whisper.start(); }
      else setModeSafe('idle');
    }
  }
  handleRef.current = handleTranscript;

  function stopEverything() {
    sessionRef.current = false; processingRef.current = false;
    wakeRef.current = false; activatedRef.current = false;
    try { mic.stop(); } catch {}
    try { whisper.stop(); } catch {}
    try { audioRef.current?.pause(); } catch {}
    stopOutAnalysis();
  }

  // Tap-to-talk (one-shot conversation).
  function toggleMic() {
    if (sessionRef.current) { stopEverything(); setWakeOn(false); setModeSafe('idle'); return; }
    sessionRef.current = true;
    wakeRef.current = false;
    setWakeOn(false);
    setModeSafe('listening');
    whisper.start();
  }

  // Hands-free "Hey Rocky" mode.
  function toggleWake() {
    if (wakeRef.current) { stopEverything(); setWakeOn(false); setModeSafe('idle'); return; }
    sessionRef.current = true;
    wakeRef.current = true;
    activatedRef.current = false;
    setWakeOn(true);
    setSteps([{ kind: 'listen', text: 'Listening for \u201cHey Rocky\u201d\u2026', id: Date.now() }]);
    setModeSafe('listening');
    whisper.start();
  }

  function submitTyped() {
    const query = q.trim();
    navigate('/chat', { state: query ? { q: query } : undefined });
  }

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
  }, []);
  const priorities = useMemo(() => {
    const items = (brief?.items || []).slice(0, 4).map((it) => it.headline || it.title || it.summary || String(it));
    return items.length ? items : ['Campaigns need attention', 'Client approvals pending', 'Leads awaiting follow-up', 'Tasks overdue'];
  }, [brief]);
  const alerts = useMemo(() => {
    const a = (insights || []).slice(0, 4).map((x) => ({
      txt: x.title || x.headline || x.summary || String(x),
      warn: (x.severity || '').toLowerCase() === 'high',
      tm: x.createdAt ? new Date(x.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
    }));
    return a.length ? a : [
      { txt: 'CPL increased in 2 campaigns', warn: false, tm: '10 min ago' },
      { txt: 'Budget exhausted in 1 campaign', warn: false, tm: '25 min ago' },
      { txt: 'Website speed issue detected', warn: true, tm: '1 hr ago' },
      { txt: 'Drop in organic traffic', warn: true, tm: '2 hr ago' },
    ];
  }, [insights]);

  const stats = [
    { v: clients.length || 14, l: 'Active Clients' },
    { v: 47, l: 'Active Campaigns' },
    { v: '₹2,48,350', l: 'Total Spend Today', hud: true },
    { v: 165, l: 'Leads Generated' },
    { v: '82%', l: 'Agency Health' },
  ];
  const live = mode !== 'idle';

  return (
    <div className="cc">
      <div className="cc-head">
        <div className="cc-greet">
          <h2>{greeting}, <b>SKYUP</b></h2>
          <p>Here's what's happening across your agency today. <span className="cc-sample" style={{ position: 'static', marginLeft: 8 }}>SAMPLE · connect sources to go live</span></p>
        </div>
        <div className="cc-ask">
          <RockyMark size={22} />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitTyped()} placeholder="Ask ROCKY anything..." />
        </div>
      </div>

      <div className="cc-panel cc-stats">
        {stats.map((s) => (
          <div className={`cc-stat ${s.hud ? 'hud' : ''}`} key={s.l}><div className="v">{s.v}</div><div className="l">{s.l}</div></div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="cc-panel cc-metric">
          <span className="cc-sample">SAMPLE</span>
          <div className="ph"><span className="ic"><Icon d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" /></span><span className="ttl">Meta Ads</span></div>
          <div className="rowm">
            <div className="m"><div className="k">Spend Today</div><div className="val">₹1,28,450</div></div>
            <div className="m"><div className="k">Conversions</div><div className="val">85</div></div>
            <div className="m"><div className="k">ROAS</div><div className="val">3.42x</div></div>
          </div>
          <Sparkline seed={2} />
        </div>
        <div className="cc-panel cc-metric">
          <span className="cc-sample">SAMPLE</span>
          <div className="ph"><span className="ic"><Icon d="M12 2 2 22h20L12 2z" /></span><span className="ttl">Google Ads</span></div>
          <div className="rowm">
            <div className="m"><div className="k">Spend Today</div><div className="val">₹76,230</div></div>
            <div className="m"><div className="k">Conversions</div><div className="val">39</div></div>
            <div className="m"><div className="k">ROAS</div><div className="val">2.81x</div></div>
          </div>
          <Sparkline seed={5} />
        </div>
        <div className="cc-panel">
          <div className="ph"><span className="ic"><Icon d="M13 2 3 14h7l-1 8 10-12h-7z" /></span><span className="ttl">Today's Priorities</span></div>
          <div className="cc-list">
            {priorities.map((p, i) => (
              <div className="cc-li" key={i}><span className="num">{i + 1}</span><span className="txt">{p}</span><span className="pd" style={{ background: ['var(--hud)', 'var(--amber)', '#4f9cf9', 'var(--muted-2)'][i % 4] }} /></div>
            ))}
          </div>
        </div>
      </div>

      <div className="cc-core-col">
        <div className="cc-core">
          <ReactiveCore activeRef={activeRef} bandsRef={bandsRef} status={STATUS[mode]} />
        </div>

        {/* Hey Rocky control + live process trail */}
        <div className="cc-panel" style={{ borderColor: wakeOn ? 'var(--hud)' : undefined }}>
          <div className="ph" style={{ justifyContent: 'space-between' }}>
            <span className="ttl">Hey Rocky</span>
            <button
              onClick={toggleWake}
              style={{
                background: wakeOn ? 'var(--hud)' : 'transparent',
                color: wakeOn ? '#0b0d16' : 'var(--hud)',
                border: '1px solid var(--hud)', borderRadius: 8, padding: '6px 12px',
                fontWeight: 700, cursor: 'pointer', fontSize: 12, letterSpacing: '0.04em',
              }}
            >
              {wakeOn ? 'LISTENING · STOP' : 'ENABLE HANDS-FREE'}
            </button>
          </div>
          <div className="cc-list" style={{ marginTop: 6 }}>
            {steps.length === 0 ? (
              <div className="cc-li"><span className="txt muted">Turn on hands-free, then say “Hey Rocky, schedule a reel for Acme at 6pm tomorrow.”</span></div>
            ) : (
              steps.map((s, i) => (
                <div className="cc-li" key={s.id} style={{ opacity: i === steps.length - 1 ? 1 : 0.5 }}>
                  <span style={{ marginRight: 8 }}>{STEP_ICON[s.kind] || '•'}</span>
                  <span className="txt" style={{ color: s.kind === 'error' ? 'var(--hud)' : '#fff' }}>{s.text}</span>
                </div>
              ))
            )}
          </div>
          {lastAction?.type === 'schedule_reel' && (
            <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--hud)', borderRadius: 8 }}>
              <div className="small" style={{ color: 'var(--hud)', fontWeight: 700 }}>📅 Reel slot created — needs video</div>
              <div className="small" style={{ marginTop: 4 }}>
                {lastAction.clientName} · {new Date(lastAction.scheduledFor).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} IST
              </div>
              <button className="cc-mic" style={{ width: 'auto', padding: '6px 12px', marginTop: 8, borderRadius: 8 }} onClick={() => navigate('/reels')}>
                Upload video →
              </button>
            </div>
          )}
        </div>

        {err && <div className="cc-panel" style={{ borderColor: 'var(--hud)', color: 'var(--hud)', textAlign: 'center' }}>{err}</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="cc-panel">
          <span className="cc-sample">SAMPLE</span>
          <div className="ph"><span className="ic"><Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5" /></span><span className="ttl">SEO Performance</span></div>
          <div className="cc-list">
            <div className="cc-li"><span className="txt">Keywords Ranked</span><b style={{ color: '#fff' }}>248</b><Delta v={18} /></div>
            <div className="cc-li"><span className="txt">Organic Traffic</span><b style={{ color: '#fff' }}>5,692</b><Delta v={12} /></div>
            <div className="cc-li"><span className="txt">Visibility Score</span><b style={{ color: '#fff' }}>62%</b></div>
          </div>
        </div>
        <div className="cc-panel">
          <span className="cc-sample">SAMPLE</span>
          <div className="ph"><span className="ic"><Icon d="M4 4h16v16H4zM4 9h16M9 4v16" /></span><span className="ttl">Social Media</span></div>
          <div className="cc-list">
            <div className="cc-li"><span className="txt">Followers</span><b style={{ color: '#fff' }}>25.4K</b><Delta v={8} /></div>
            <div className="cc-li"><span className="txt">Engagement Rate</span><b style={{ color: '#fff' }}>4.7%</b><Delta v={0.9} /></div>
            <div className="cc-li"><span className="txt">Posts This Week</span><b style={{ color: '#fff' }}>24</b><Delta v={6} /></div>
          </div>
        </div>
        <div className="cc-panel">
          <div className="ph"><span className="ttl" style={{ margin: '0 auto' }}>Agency Health Score</span></div>
          <Gauge value={82} />
        </div>
      </div>

      <div className="cc-panel" style={{ gridColumn: '1 / 2' }}>
        <span className="cc-sample">SAMPLE</span>
        <div className="ph"><span className="ttl">Top Campaigns</span></div>
        <table className="cc-tbl">
          <thead><tr><th>Campaign</th><th>CTR</th><th>ROAS</th></tr></thead>
          <tbody>
            {[['XYZ Properties', '2.48%', '4.21x'], ['Kapees Interiors', '3.67%', '3.89x'], ['ABC School', '2.11%', '5.12x'], ['Fitness Pro', '3.02%', '3.15x']].map((r) => (
              <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td className="g">{r[2]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cc-panel" style={{ gridColumn: '2 / 3' }}>
        <span className="cc-sample">SAMPLE</span>
        <div className="ph"><span className="ttl">Leads Overview</span></div>
        <Donut />
      </div>
      <div style={{ gridColumn: '3 / 4' }}>
        <ActivityFeed />
      </div>

      <div className="cc-cmdbar">
        <div className="wf">{Array.from({ length: 6 }).map((_, i) => (
          <i key={i} style={{ height: live ? `${6 + Math.random() * 16}px` : '6px', transition: 'height 0.15s' }} />
        ))}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
          placeholder="Ask ROCKY to analyze, create, or take action..." />
        <button className={`cc-mic ${live ? 'live' : ''}`} onClick={toggleMic} title={live ? 'Stop' : 'Talk to Rocky'}>
          <Icon d={live ? 'M6 6h12v12H6z' : 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10a7 7 0 0 1-14 0M12 17v4M8 21h8'} />
        </button>
      </div>
    </div>
  );
}