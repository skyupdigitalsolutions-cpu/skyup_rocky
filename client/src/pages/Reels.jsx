import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiError } from '../api/client.js';
import { Chip, Loader, Empty } from '../components/ui.jsx';
import WatchFolderCard from '../components/WatchFolderCard.jsx';

// Reels scheduler: upload a video (direct to Cloudinary), pick a date/time,
// optionally auto-caption, and drop it in the queue. The server-side poller
// publishes each reel when its time arrives (DRY_RUN-safe until IG is live).

const STATUS_TONE = {
  scheduled: 'accent',
  processing: 'amber',
  published: 'green',
  failed: 'red',
  retry: 'amber',
  canceled: 'default',
  draft: 'default',
};

export default function Reels() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // composer state
  const [media, setMedia] = useState(null); // {videoUrl, publicId, thumbnailUrl, durationSec, ...}
  const [uploading, setUploading] = useState(0); // 0..100, 0 = idle
  const [caption, setCaption] = useState('');
  const [when, setWhen] = useState(defaultWhen());
  const [mode, setMode] = useState('auto');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/clients');
        const list = data.clients || data || [];
        setClients(list);
        const skyup = list.find((c) => /skyup/i.test(c.name)) || list[0];
        setClientId(skyup?.id || skyup?._id || '');
      } catch (e) {
        setErr(apiError(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (clientId) loadPosts();
  }, [clientId]);

  async function loadPosts() {
    setLoading(true);
    try {
      const { data } = await api.get('/reels', { params: { client: clientId } });
      setPosts(data.posts || []);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    try {
      setUploading(1);
      const { data: sig } = await api.post('/reels/upload-signature', {});
      const secureUrl = await uploadToCloudinary(file, sig, setUploading);
      setMedia({
        videoUrl: secureUrl.secure_url,
        publicId: secureUrl.public_id,
        thumbnailUrl: thumbFrom(secureUrl.secure_url),
        durationSec: Math.round(secureUrl.duration || 0),
        sizeBytes: secureUrl.bytes || 0,
        width: secureUrl.width || 0,
        height: secureUrl.height || 0,
      });
    } catch (e2) {
      setErr(apiError(e2) || 'Upload failed');
    } finally {
      setUploading(0);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function generateCaption() {
    if (!clientId) return;
    setBusy(true);
    try {
      const { data } = await api.post('/reels/caption', { client: clientId });
      setCaption(data.caption || '');
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function schedule() {
    if (!media?.videoUrl) return setErr('Upload a video first.');
    if (!when) return setErr('Pick a date & time.');
    setBusy(true);
    setErr('');
    try {
      await api.post('/reels', {
        client: clientId,
        media,
        caption,
        scheduledFor: new Date(when).toISOString(),
        publishMode: mode,
      });
      setMedia(null);
      setCaption('');
      setWhen(defaultWhen());
      await loadPosts();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(id, path) {
    setBusy(true);
    try {
      await api.post(`/reels/${id}/${path}`);
      await loadPosts();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setBusy(true);
    try {
      await api.delete(`/reels/${id}`);
      await loadPosts();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => groupByDay(posts), [posts]);

  return (
    <div className="page" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="between">
        <div>
          <h1>Reels Scheduler</h1>
          <div className="small muted">Upload, schedule, and auto-publish Instagram Reels.</div>
        </div>
        <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ minWidth: 200 }}>
          {clients.map((c) => (
            <option key={c.id || c._id} value={c.id || c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{err}</div>}

      <WatchFolderCard />

      {/* Composer */}
      <div className="card">
        <div className="section-title">New reel</div>
        <div className="grid cols-2" style={{ gap: 18, alignItems: 'start' }}>
          <div>
            <div className="label">Video</div>
            {!media ? (
              <label className="btn ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>
                {uploading ? `Uploading… ${uploading}%` : 'Choose video'}
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/*"
                  onChange={onPickFile}
                  disabled={!!uploading}
                  style={{ display: 'none' }}
                />
              </label>
            ) : (
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                {media.thumbnailUrl ? (
                  <img src={media.thumbnailUrl} alt="thumb" style={{ width: 84, height: 112, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                ) : null}
                <div className="small">
                  <div>{media.durationSec}s · {(media.sizeBytes / 1e6).toFixed(1)} MB</div>
                  <div className="muted">{media.width}×{media.height}</div>
                  <button className="btn ghost sm mt-sm" onClick={() => setMedia(null)}>Replace</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="between">
              <div className="label">Caption</div>
              <button className="btn ghost sm" onClick={generateCaption} disabled={busy || !clientId}>
                ✨ Generate
              </button>
            </div>
            <textarea
              className="textarea"
              rows={5}
              placeholder="Write a caption, or hit Generate…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
        </div>

        <div className="row wrap mt" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="field">
            <div className="label">Publish at</div>
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="field">
            <div className="label">Mode</div>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="auto">Auto (fires on schedule)</option>
              <option value="approval">Hold for approval</option>
            </select>
          </div>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={schedule} disabled={busy || !!uploading || !media}>
            {busy ? 'Scheduling…' : 'Schedule reel'}
          </button>
        </div>
      </div>

      {/* Queue */}
      {loading ? (
        <Loader label="Loading queue…" />
      ) : posts.length === 0 ? (
        <Empty title="Nothing scheduled yet" hint="Upload a video above and pick a time to fill the calendar." />
      ) : (
        grouped.map(([day, items]) => (
          <div key={day}>
            <div className="section-title">{day}</div>
            <div className="grid" style={{ gap: 10 }}>
              {items.map((p) => (
                <PostRow key={p._id} p={p} busy={busy} onAct={act} onRemove={remove} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function PostRow({ p, busy, onAct, onRemove }) {
  return (
    <div className="card row" style={{ gap: 14, alignItems: 'center' }}>
      {p.media?.thumbnailUrl ? (
        <img src={p.media.thumbnailUrl} alt="" style={{ width: 54, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
      ) : (
        <div style={{ width: 54, height: 72, borderRadius: 6, background: 'var(--panel-2)' }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <strong>{timeOf(p.scheduledFor)}</strong>
          <Chip tone={STATUS_TONE[p.status] || 'default'}>{p.status}</Chip>
          {p.publishMode === 'approval' && !p.approvedAt && <Chip tone="amber">needs approval</Chip>}
          {p.dryRun && <Chip>dry-run</Chip>}
        </div>
        <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.caption?.split('\n')[0] || <em>no caption</em>}
        </div>
        {p.lastError && <div className="small" style={{ color: 'var(--red)' }}>{p.lastError}</div>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {p.permalink && (
          <a className="btn ghost sm" href={p.permalink} target="_blank" rel="noreferrer">View</a>
        )}
        {p.publishMode === 'approval' && !p.approvedAt && ['scheduled', 'draft'].includes(p.status) && (
          <button className="btn primary sm" disabled={busy} onClick={() => onAct(p._id, 'approve')}>Approve</button>
        )}
        {['scheduled', 'retry', 'failed', 'draft'].includes(p.status) && (
          <button className="btn ghost sm" disabled={busy} onClick={() => onAct(p._id, 'publish-now')}>Publish now</button>
        )}
        {!['published', 'canceled'].includes(p.status) && (
          <button className="btn ghost sm" disabled={busy} onClick={() => onAct(p._id, 'cancel')}>Cancel</button>
        )}
        <button className="btn danger sm" disabled={busy} onClick={() => onRemove(p._id)}>Delete</button>
      </div>
    </div>
  );
}

// ---- helpers ----------------------------------------------------------------

function uploadToCloudinary(file, sig, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', sig.apiKey);
    form.append('timestamp', sig.timestamp);
    form.append('folder', sig.folder);
    form.append('signature', sig.signature);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', sig.uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.max(1, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(res);
        else reject(new Error(res?.error?.message || `Cloudinary ${xhr.status}`));
      } catch {
        reject(new Error('Cloudinary response parse error'));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(form);
  });
}

// Cloudinary can generate a poster frame by inserting a transformation and
// swapping the extension to .jpg (first frame).
function thumbFrom(videoUrl) {
  try {
    return videoUrl.replace('/upload/', '/upload/so_0,w_400,h_540,c_fill/').replace(/\.\w+$/, '.jpg');
  } catch {
    return '';
  }
}

function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000); // +1h
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function groupByDay(posts) {
  const map = new Map();
  for (const p of posts) {
    const key = new Date(p.scheduledFor).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.entries()];
}

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}