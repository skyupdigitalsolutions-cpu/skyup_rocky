import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client.js';

export default function WatchFolderCard() {
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState({ enabled: false, dir: '', intervalSec: 20, defaultClient: 'Skyup', dailyTime: '18:00', collabEnabled: false, collaborators: [] });
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [open, setOpen] = useState(false);
  const [winOnly, setWinOnly] = useState(false); // server is not Windows

  const load = async () => {
    try {
      const { data } = await api.get('/reels/watch-config');
      setCfg({ enabled: !!data.config.enabled, dir: data.config.dir || '', intervalSec: data.config.intervalSec || 20, defaultClient: data.config.defaultClient || 'Skyup', dailyTime: data.config.dailyTime || '18:00', collabEnabled: !!data.config.collabEnabled, collaborators: data.config.collaborators || [] });
      setStatus(data.status);
      if (data.config.enabled) setOpen(true);
    } catch (e) {
      if (e?.response?.status === 403) setHidden(true);
      else setErr(apiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const browse = async () => {
    setBrowsing(true);
    setErr('');
    setMsg('');
    try {
      const { data } = await api.post('/reels/watch-config/browse');
      if (data.unsupported) {
        setWinOnly(true);
        setErr('Folder picker only works when the server runs on Windows. Type the path manually.');
        return;
      }
      if (data.path) {
        setCfg((c) => ({ ...c, dir: data.path }));
        setMsg('Folder selected — click Save to apply.');
      } else {
        setMsg('No folder selected.');
      }
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBrowsing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const { data } = await api.put('/reels/watch-config', cfg);
      setStatus(data.status);
      setMsg(cfg.enabled ? 'Saved — Rocky is now watching that folder.' : 'Saved — watching is off.');
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const scanNow = async () => {
    setScanning(true);
    setErr('');
    setMsg('');
    try {
      const { data } = await api.post('/reels/watch-config/scan-now');
      setStatus(data.status);
      const r = data.result || {};
      setMsg(`Scan done — ${r.scheduled || 0} scheduled, ${r.failed || 0} failed.`);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setScanning(false);
    }
  };

  if (hidden || loading) return null;

  return (
    <div className="card" style={{ borderColor: cfg.enabled ? 'var(--hud, #4f9cf9)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3>📂 Auto-schedule from a folder</h3>
          <div className="small muted">Drop named videos in a folder — Rocky picks them up and schedules them automatically.</div>
        </div>
        <button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Configure'}</button>
      </div>

      {open && (
        <div className="mt" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Enable toggle */}
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
            <span>Enable folder watching</span>
          </label>

          {/* Folder path — input + Browse button */}
          <div className="field">
            <label>Watch folder</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder="Click Browse or type a path…"
                value={cfg.dir}
                onChange={(e) => setCfg({ ...cfg, dir: e.target.value })}
                style={{ flex: 1 }}
              />
              <button
                className="btn primary"
                onClick={browse}
                disabled={browsing}
                title="Opens a Windows folder-picker dialog"
                style={{ whiteSpace: 'nowrap' }}
              >
                {browsing ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="spin" /> Opening…
                  </span>
                ) : '📁 Browse'}
              </button>
            </div>
            <div className="small muted mt-sm">
              Clicking Browse opens the Windows folder selector on this PC. Rocky will create <code>_processed</code> and <code>_failed</code> subfolders automatically.
            </div>
          </div>

          {/* Check interval */}
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Check every (seconds)</label>
            <input
              className="input"
              type="number"
              min={5}
              max={3600}
              value={cfg.intervalSec}
              onChange={(e) => setCfg({ ...cfg, intervalSec: Number(e.target.value) || 20 })}
            />
          </div>

          {/* Simple-mode defaults: fixed client + daily time */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label>Default client (for numbered files)</label>
              <input
                className="input"
                placeholder="Skyup"
                value={cfg.defaultClient}
                onChange={(e) => setCfg({ ...cfg, defaultClient: e.target.value })}
              />
            </div>
            <div className="field" style={{ maxWidth: 160 }}>
              <label>Daily post time</label>
              <input
                className="input"
                type="time"
                value={cfg.dailyTime}
                onChange={(e) => setCfg({ ...cfg, dailyTime: e.target.value })}
              />
            </div>
          </div>

          {/* Collaborators — auto @mention on every reel */}
          <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={cfg.collabEnabled} onChange={(e) => setCfg({ ...cfg, collabEnabled: e.target.checked })} />
              <span>Auto-mention collaborators on every reel</span>
            </label>
            <input
              className="input"
              style={{ marginTop: 8 }}
              placeholder="instagram handles, comma separated — e.g. skyup.digital, partner.brand"
              value={(cfg.collaborators || []).join(', ')}
              onChange={(e) => setCfg({ ...cfg, collaborators: e.target.value.split(/[\s,]+/).map((h) => h.replace(/^@/, '').trim()).filter(Boolean) })}
            />
            <div className="small muted mt-sm">
              Instagram's API can't add true co-authors, so Rocky appends these as <code>@mentions</code> in every caption instead. Add or remove anytime — it applies to all future reels.
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn ghost" onClick={scanNow} disabled={scanning || !cfg.enabled || !cfg.dir}>
              {scanning ? 'Scanning…' : 'Scan now'}
            </button>
          </div>

          {msg && <div className="small" style={{ color: 'var(--green, #3dd68c)' }}>{msg}</div>}
          {err && <div className="small" style={{ color: 'var(--red, #f87171)' }}>{err}</div>}
          {winOnly && (
            <div className="small muted">You can still type the path manually above and click Save — it works the same way.</div>
          )}

          {/* Status */}
          {status && (
            <div className="small muted" style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>Cloudinary: {status.cloudinaryReady ? '✅ ready' : '⚠️ not configured (set CLOUDINARY_* in .env)'}</div>
              {status.currentDir && <div>Watching: <code>{status.currentDir}</code></div>}
              {status.lastScanAt && (
                <div>Last scan: {new Date(status.lastScanAt).toLocaleString()} — {status.lastResult?.scheduled || 0} scheduled, {status.lastResult?.failed || 0} failed</div>
              )}
              {status.lastError && <div style={{ color: 'var(--red, #f87171)' }}>Last error: {status.lastError}</div>}
            </div>
          )}

          {/* Naming guide */}
          <div className="small muted" style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, lineHeight: 1.7 }}>
            <strong>Simple naming (recommended):</strong> just number the files —<br />
            <code>1.mp4</code>, <code>2.mp4</code>, <code>3.mp4</code> …<br />
            Each is auto-slotted to the next free <strong>{cfg.dailyTime}</strong> slot for <strong>{cfg.defaultClient || 'Skyup'}</strong>, in order. Drop 7 files → they fill the next 7 days.<br /><br />
            <strong>Advanced (optional):</strong> <code>client__YYYY-MM-DD__HHMM.mp4</code> for an exact one-off time.<br />
            Captions are auto-written by Rocky watching the video; or add a <code>.txt</code> sidecar to override.
          </div>
        </div>
      )}
    </div>
  );
}