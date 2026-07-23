import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

// Live "what's happening now" feed. Polls the activity endpoint every few
// seconds and renders the real pipeline (upload → caption → schedule →
// publishing → published). The newest 'published' event with an Instagram
// link is pinned to the top as a tappable notification.
const KIND_ICON = {
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  caption: 'M4 5h16v11H8l-4 4V5z',
  schedule: 'M8 2v4M16 2v4M3 10h18M5 6h14v14H5z',
  publish_start: 'M5 12h14M13 6l6 6-6 6',
  publish_step: 'M12 2v4M12 18v4M2 12h4M18 12h4',
  published: 'M20 6 9 17l-5-5',
  failed: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 8v4l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};
const STATE_COLOR = { running: 'var(--amber)', success: 'var(--green)', error: 'var(--hud)', info: 'var(--muted)' };

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ActivityFeed({ clientId }) {
  const [items, setItems] = useState([]);
  const seenPublished = useRef(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get('/reels/activity', { params: clientId ? { client: clientId, limit: 30 } : { limit: 30 } });
        if (!alive) return;
        const list = data.activity || [];
        setItems(list);
        // Surface a new published-with-link event as a toast notification.
        const pub = list.find((a) => a.kind === 'published' && a.permalink);
        if (pub && pub._id !== seenPublished.current) {
          if (seenPublished.current !== null) setToast(pub); // don't toast on first load
          seenPublished.current = pub._id;
        }
      } catch { /* ignore poll errors */ }
    };
    load();
    const id = setInterval(load, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [clientId]);

  return (
    <div className="cc-panel" style={{ position: 'relative' }}>
      <div className="ph">
        <span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 8v4l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" /></svg></span>
        <span className="ttl">Live Activity</span>
        <span className="link" style={{ cursor: 'default', color: 'var(--green)' }}>● live</span>
      </div>

      {toast && (
        <a href={toast.permalink} target="_blank" rel="noreferrer"
          onClick={() => setTimeout(() => setToast(null), 100)}
          style={{ display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none',
            border: '1px solid var(--green)', background: 'rgba(38,224,122,0.08)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          {toast.thumbnailUrl && <img src={toast.thumbnailUrl} alt="" style={{ width: 34, height: 46, objectFit: 'cover', borderRadius: 6 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--green)', fontFamily: 'var(--ui)', fontWeight: 700, fontSize: 13 }}>New reel is live 🎉</div>
            <div className="small muted">Tap to view on Instagram</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M7 17 17 7M9 7h8v8" /></svg>
        </a>
      )}

      {items.length === 0 ? (
        <div className="small muted" style={{ padding: '10px 0' }}>Nothing yet. Drop a video in the watch folder or upload on the Reels page — the pipeline will stream here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 340, overflowY: 'auto' }}>
          {items.map((a) => (
            <div key={a._id} className="cc-li" style={{ alignItems: 'flex-start', gap: 10 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={STATE_COLOR[a.state] || 'var(--muted)'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 2, flex: 'none' }}>
                <path d={KIND_ICON[a.kind] || KIND_ICON.info} />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span className="txt" style={{ fontWeight: 600 }}>{a.title}</span>
                  {a.state === 'running' && <span className="small" style={{ color: 'var(--amber)' }}>…</span>}
                </div>
                {a.detail && <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.detail}</div>}
                <div className="small" style={{ color: 'var(--muted-2)', fontFamily: 'var(--mono)', fontSize: 10 }}>
                  {a.clientName ? `${a.clientName} · ` : ''}{timeAgo(a.createdAt)}
                  {a.permalink && <> · <a href={a.permalink} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>view</a></>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}