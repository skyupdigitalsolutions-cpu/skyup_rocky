import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiError } from '../api/client.js';
import { GroundingPanel, Chip } from '../components/ui.jsx';
import { useVoice } from '../hooks/useVoice.js';

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_28d', label: 'Last 28 days' },
  { value: 'last_90d', label: 'Last 90 days' },
];

const SUGGESTIONS = [
  "Give me today's agency briefing",
  "How did this client's Meta campaigns perform last 7 days vs prior 7?",
  'Which paid campaigns need attention and why?',
  'Schedule a reel for Acme at 6pm tomorrow',
  'What are the top 3 priorities for this client?',
];

// ---- Scheduled reel confirmation card --------------------------------------
function ScheduleActionCard({ action }) {
  const navigate = useNavigate();
  if (!action || action.type !== 'schedule_reel') return null;
  const time = new Date(action.scheduledFor).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div
      style={{
        marginTop: 10,
        background: 'linear-gradient(135deg,#0e1e38,#101d30)',
        border: '1px solid #2a4070',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 420,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>📅</span>
        <strong style={{ color: 'var(--accent)' }}>Reel slot created</strong>
        <Chip tone="amber">needs video</Chip>
      </div>
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div><span style={{ color: 'var(--muted)' }}>Client: </span>{action.clientName}</div>
        <div><span style={{ color: 'var(--muted)' }}>When: </span>{time} IST</div>
        <div>
          <span style={{ color: 'var(--muted)' }}>Mode: </span>
          {action.publishMode === 'approval' ? 'Hold for approval' : 'Auto-publish'}
        </div>
        {action.caption && (
          <div><span style={{ color: 'var(--muted)' }}>Caption: </span>"{action.caption}"</div>
        )}
      </div>
      <button
        className="btn primary sm"
        onClick={() => navigate('/reels')}
        style={{ alignSelf: 'flex-start' }}
      >
        Upload video → Social Media
      </button>
    </div>
  );
}

// ---- Main chat page --------------------------------------------------------
export default function RockyChat() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [preset, setPreset] = useState('last_7d');
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  const { listening, speaking, sttSupported, ttsSupported, startListening, stopListening, speak, stopSpeaking } =
    useVoice({ onFinalTranscript: (t) => setInput((prev) => (prev ? prev + ' ' : '') + t) });

  useEffect(() => {
    api.get('/clients').then(({ data }) => setClients(data.clients || [])).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const contextPayload = useCallback(
    () => ({ client: clientId || null, dateRange: { preset }, service: '' }),
    [clientId, preset]
  );

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setError('');
    setInput('');
    setMessages((m) => [...m, { role: 'user', content, _local: true }]);
    setSending(true);
    try {
      let convId = conversationId;
      if (!convId) {
        const { data } = await api.post('/chat/conversations', { context: contextPayload() });
        convId = data.conversation._id;
        setConversationId(convId);
      }
      const { data } = await api.post(`/chat/conversations/${convId}/messages`, {
        content,
        context: contextPayload(),
      });
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: data.message.content,
          grounding: data.grounding,
          action: data.action || null,
        },
      ]);
      if (autoSpeak) speak(data.message.content);
    } catch (err) {
      setError(apiError(err));
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${apiError(err)}`, _error: true }]);
    } finally {
      setSending(false);
    }
  };

  const resetConversation = () => {
    setConversationId(null);
    setMessages([]);
    stopSpeaking();
  };

  const activeClientName = clients.find((c) => c._id === clientId)?.name;

  return (
    <div className="chat-wrap">
      {/* Context selector */}
      <div className="row wrap between" style={{ marginBottom: 12 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <select
            className="select"
            style={{ width: 220 }}
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); resetConversation(); }}
          >
            <option value="">All clients (agency-wide)</option>
            {clients.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
          <select
            className="select"
            style={{ width: 160 }}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <Chip tone="accent">{activeClientName || 'All clients'}</Chip>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {ttsSupported && (
            <button
              className={`btn sm ${autoSpeak ? 'primary' : 'ghost'}`}
              onClick={() => { setAutoSpeak((v) => !v); if (autoSpeak) stopSpeaking(); }}
              title="Read answers aloud"
            >
              {autoSpeak ? '🔊 Voice on' : '🔈 Voice off'}
            </button>
          )}
          {messages.length > 0 && (
            <button className="btn sm ghost" onClick={resetConversation}>New chat</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="card" style={{ maxWidth: 720 }}>
            <h3>Ask Rocky about your clients</h3>
            <div className="muted small mt-sm mb">
              Rocky answers from connected data and uploaded documents — and can schedule reels directly from chat.
            </div>
            <div className="grid" style={{ gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="btn ghost"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="avatar">{m.role === 'user' ? 'You' : 'R'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="bubble">{m.content}</div>
              {m.role === 'assistant' && !m._error && (
                <>
                  <ScheduleActionCard action={m.action} />
                  <GroundingPanel grounding={m.grounding} />
                </>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="msg assistant">
            <div className="avatar">R</div>
            <div className="bubble pulse muted">Rocky is thinking…</div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="composer">
        {sttSupported && (
          <button
            className={`btn ${listening ? 'primary' : 'ghost'}`}
            onClick={() => (listening ? stopListening() : startListening())}
            title="Speak your question"
            style={{ minWidth: 44 }}
          >
            {listening ? '● Stop' : '🎤'}
          </button>
        )}
        <textarea
          className="textarea"
          style={{ minHeight: 46, maxHeight: 160 }}
          placeholder={
            listening
              ? 'Listening…'
              : 'Ask about performance, a client, or say "Schedule a reel for Acme at 6pm tomorrow"…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary" onClick={() => send()} disabled={sending || !input.trim()}>
          {sending ? <span className="spin" /> : 'Send'}
        </button>
        {speaking && (
          <button className="btn sm ghost" onClick={stopSpeaking}>Stop 🔊</button>
        )}
      </div>
      {error && <div className="missing-note mt-sm">{error}</div>}
    </div>
  );
}