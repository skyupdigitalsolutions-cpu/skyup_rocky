import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, apiError } from '../api/client.js';
import { Loader, Empty, Chip, SeverityChip } from '../components/ui.jsx';
import { useAuth } from '../store/auth.jsx';

const PROVIDER_LABEL = { meta: 'Meta Ads', google_ads: 'Google Ads', search_console: 'Search Console', ga4: 'GA4' };

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState({ title: '', kind: 'strategy', text: '' });
  const [savingDoc, setSavingDoc] = useState(false);
  const [refs, setRefs] = useState({ metaAdAccountId: '', facebookPageId: '', googleAdsCustomerId: '', gscSiteUrl: '', ga4PropertyId: '' });
  const [savingRefs, setSavingRefs] = useState(false);
  const [refsMsg, setRefsMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [detail, docs] = await Promise.all([api.get(`/clients/${id}`), api.get(`/documents/${id}`)]);
      setData(detail.data);
      setDocuments(docs.data.documents || []);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const addDoc = async () => {
    if (!paste.title.trim() || !paste.text.trim()) return;
    setSavingDoc(true);
    try {
      await api.post('/documents/paste', { clientId: id, ...paste });
      setPaste({ title: '', kind: 'strategy', text: '' });
      setTimeout(load, 600); // give background ingest a moment
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSavingDoc(false);
    }
  };

  const saveRefs = async () => {
    setSavingRefs(true); setRefsMsg('');
    try {
      await api.patch(`/clients/${id}`, { accountRefs: refs });
      setRefsMsg('Saved — reconnect the integration to use the new account ID.');
      await load();
    } catch (e) { setRefsMsg(apiError(e)); } finally { setSavingRefs(false); }
  };

    if (loading) return <Loader label="Loading client…" />;
  if (!data) return <Empty title="Client not found" action={<Link className="btn sm" to="/clients">Back to clients</Link>} />;

  const { client, integrations = [], insights = [] } = data;

  return (
    <div>
      <div className="row between mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>{client.name}</h1>
            <Chip tone={client.status === 'active' ? 'green' : 'default'}>{client.status}</Chip>
          </div>
          <div className="muted small mt-sm">{client.industry || '—'} {client.website && <>· <a href={client.website} target="_blank" rel="noreferrer">{client.website}</a></>}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => navigate(`/chat`)}>Ask Rocky about this client</button>
          <button className="btn primary" onClick={() => navigate(`/integrations/${id}`)}>Manage integrations</button>
        </div>
      </div>

      {error && <div className="missing-note mb">{error}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <div className="grid">
          {/* Profile */}
          <div className="card">
            <div className="section-title">Client brain — profile</div>
            <ProfileRow label="Goals" value={client.goals} />
            <ProfileRow label="Target market" value={client.targetMarket} />
            <ProfileRow label="Brand notes" value={client.brandNotes} />
            <div className="divider" />
            <div className="section-title">Services</div>
            {(client.services || []).length === 0 ? (
              <div className="muted small">No services listed.</div>
            ) : (
              <div className="grid" style={{ gap: 8 }}>
                {client.services.map((s, i) => (
                  <div key={i} className="row between panel" style={{ padding: 10 }}>
                    <div><strong>{s.name}</strong> <Chip>{s.status}</Chip></div>
                    <div className="muted small">{s.monthlyBudget ? `₹${s.monthlyBudget.toLocaleString('en-IN')}/mo` : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="card">
            <div className="section-title">Documents (Client Brain / RAG)</div>
            {documents.length === 0 ? (
              <div className="muted small mb">No documents yet. Paste knowledge below so Rocky can answer from it.</div>
            ) : (
              <div className="grid" style={{ gap: 8, marginBottom: 14 }}>
                {documents.map((d) => (
                  <div key={d._id} className="row between panel" style={{ padding: 10 }}>
                    <div>
                      <strong>{d.title}</strong> <span className="muted small">· {d.kind}</span>
                      {d.error && <div className="small" style={{ color: 'var(--amber)' }}>{d.error}</div>}
                    </div>
                    <Chip tone={d.status === 'ready' ? 'green' : d.status === 'failed' ? 'red' : 'amber'}>
                      {d.status}{d.status === 'ready' ? ` · ${d.chunkCount} chunks` : ''}
                    </Chip>
                  </div>
                ))}
              </div>
            )}
            {can('document:write') && (
              <div className="panel" style={{ padding: 14 }}>
                <div className="field"><label>Title</label><input className="input" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} placeholder="e.g. Q3 Strategy Brief" /></div>
                <div className="field">
                  <label>Type</label>
                  <select className="select" value={paste.kind} onChange={(e) => setPaste({ ...paste, kind: e.target.value })}>
                    {['strategy', 'brief', 'meeting_notes', 'report', 'website_notes', 'campaign', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div className="field"><label>Content</label><textarea className="textarea" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} placeholder="Paste notes, strategy, meeting summary…" /></div>
                <button className="btn primary" onClick={addDoc} disabled={savingDoc || !paste.title.trim() || !paste.text.trim()}>
                  {savingDoc ? <span className="spin" /> : 'Add to client brain'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="grid">
          <div className="card">
            <div className="section-title">Connected data sources</div>
            <div className="grid" style={{ gap: 8 }}>
              {['meta', 'google_ads', 'search_console', 'ga4'].map((p) => {
                const integ = integrations.find((i) => i.provider === p);
                const connected = integ?.status === 'connected';
                return (
                  <div key={p} className="row between panel" style={{ padding: 10 }}>
                    <div>{PROVIDER_LABEL[p]}</div>
                    <Chip tone={connected ? 'green' : 'default'}>
                      {connected ? 'Connected' : integ?.status === 'error' ? 'Error' : 'Not connected'}
                    </Chip>
                  </div>
                );
              })}
            </div>
            <button className="btn sm mt" onClick={() => navigate(`/integrations/${id}`)}>Manage →</button>

          <div className="divider" />
          <div className="section-title">Account references</div>
          <div className="small muted" style={{ marginBottom: 10 }}>These IDs tell Rocky which account to read and write for each platform.</div>

          <div className="field"><label>Meta Ad Account ID</label>
            <input className="input" placeholder="e.g. 1639746160317791  (no act_ prefix)" value={refs.metaAdAccountId}
              onChange={(e) => setRefs({ ...refs, metaAdAccountId: e.target.value.replace(/^act_/, '').trim() })} /></div>

          <div className="field"><label>Facebook Page ID</label>
            <input className="input" placeholder="e.g. 104156789012345" value={refs.facebookPageId}
              onChange={(e) => setRefs({ ...refs, facebookPageId: e.target.value.trim() })} /></div>

          <div className="field"><label>Google Ads Customer ID</label>
            <input className="input" placeholder="e.g. 111-222-3333" value={refs.googleAdsCustomerId}
              onChange={(e) => setRefs({ ...refs, googleAdsCustomerId: e.target.value.trim() })} /></div>

          <div className="field"><label>Search Console Site URL</label>
            <input className="input" placeholder="e.g. https://skyupdigital.in/" value={refs.gscSiteUrl}
              onChange={(e) => setRefs({ ...refs, gscSiteUrl: e.target.value.trim() })} /></div>

          <div className="field"><label>GA4 Property ID</label>
            <input className="input" placeholder="e.g. 123456789" value={refs.ga4PropertyId}
              onChange={(e) => setRefs({ ...refs, ga4PropertyId: e.target.value.trim() })} /></div>

          {can('client:write') && (
            <button className="btn primary sm" onClick={saveRefs} disabled={savingRefs}>
              {savingRefs ? 'Saving…' : 'Save account IDs'}
            </button>
          )}
          {refsMsg && <div className="small mt-sm" style={{ color: refsMsg.startsWith('Saved') ? 'var(--green)' : 'var(--red)' }}>{refsMsg}</div>}
          </div>

          <div className="card">
            <div className="section-title">Recent insights</div>
            {insights.length === 0 ? (
              <div className="muted small">No insights yet. They appear after data syncs and briefs run.</div>
            ) : (
              <div className="grid" style={{ gap: 8 }}>
                {insights.map((i) => (
                  <div key={i._id} className="panel" style={{ padding: 10 }}>
                    <div className="row between"><SeverityChip severity={i.severity} /><span className="small muted">{i.source}</span></div>
                    <div className="mt-sm small">{i.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="small muted">{label}</div>
      <div>{value || <span className="muted">—</span>}</div>
    </div>
  );
}