import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api, apiError } from '../api/client.js';
import { Loader, Chip } from '../components/ui.jsx';

const META = {
  meta: { label: 'Meta Ads', desc: 'Campaign, ad-set & ad metrics (read-only).' },
  google_ads: { label: 'Google Ads', desc: 'Campaign spend, clicks & conversions (read-only).' },
  search_console: { label: 'Search Console', desc: 'Queries, pages, clicks, impressions, position.' },
  ga4: { label: 'GA4', desc: 'Sessions, engagement & conversion events.' },
  instagram: { label: 'Instagram', desc: 'Connect Instagram business account for Reels publishing.' },
};

export default function Integrations() {
  const { clientId } = useParams();
  const [params, setParams] = useSearchParams();
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, integ] = await Promise.all([api.get(`/clients/${clientId}`), api.get(`/integrations/${clientId}`)]);
      setClient(c.data.client);
      setRows(integ.data.integrations || []);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  // Handle OAuth callback redirect params.
  useEffect(() => {
    const connect = params.get('connect');
    if (!connect) return;
    if (connect === 'success') setNotice(`Connected ${params.get('provider') || 'account'} successfully.`);
    else if (connect === 'denied') setError('Authorization was denied.');
    else if (connect === 'error') setError(`Connection failed: ${params.get('message') || 'unknown error'}`);
    else if (connect === 'badstate') setError('Connection expired — please try again.');
    const next = new URLSearchParams(params);
    ['connect', 'provider', 'message'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  }, [params, setParams]);

  const connect = async (provider, simulate = false) => {
    setBusy(provider);
    setError('');
    try {
      const { data } = await api.post(`/integrations/${clientId}/${provider}/connect${simulate ? '?simulate=1' : ''}`);
      if (data.authUrl) {
        window.location.href = data.authUrl; // real OAuth
        return;
      }
      setNotice(`${META[provider].label} connected (simulated).`);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy('');
    }
  };

  const disconnect = async (provider) => {
    setBusy(provider);
    try {
      await api.post(`/integrations/${clientId}/${provider}/disconnect`);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy('');
    }
  };

  const sync = async (provider) => {
    setBusy(provider);
    setNotice('');
    try {
      const { data } = await api.post(`/integrations/${clientId}/${provider}/sync`);
      const r = data.result || {};
      setNotice(
        r.ok
          ? `Synced ${META[provider].label}${typeof r.snapshots === 'number' ? ` — ${r.snapshots} snapshots` : ''}.`
          : `${META[provider].label}: ${r.message || r.reason || 'nothing to sync'}.`
      );
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <Loader />;

  return (
    <div>
      <div className="row between mb">
        <div>
          <h1>{client?.name} — integrations</h1>
          <div className="muted small mt-sm">All connections are read-only in V1. Tokens are encrypted server-side and never shown here.</div>
        </div>
        <Link className="btn sm ghost" to={`/clients/${clientId}`}>← Back to client</Link>
      </div>

      {notice && <div className="missing-note mb" style={{ borderLeftColor: 'var(--green)', background: '#10281d', color: 'var(--green)' }}>{notice}</div>}
      {error && <div className="missing-note mb">{error}</div>}

      <div className="grid cols-2">
        {rows.map((row) => {
          const meta = META[row.provider];
           if (!meta) return null;
          const connected = row.status === 'connected';
          return (
            <div key={row.provider} className="card">
              <div className="row between">
                <div>
                  <h3>{meta.label}</h3>
                  <div className="muted small mt-sm">{meta.desc}</div>
                </div>
                <Chip tone={connected ? 'green' : row.status === 'error' ? 'red' : 'default'}>
                  {connected ? 'Connected' : row.status === 'error' ? 'Error' : 'Not connected'}
                </Chip>
              </div>

              <div className="row wrap small muted mt" style={{ gap: 10 }}>
                {!row.configured && <Chip tone="amber">API creds not set in .env</Chip>}
                {row.lastSyncAt && <span>Last sync: {new Date(row.lastSyncAt).toLocaleString()}</span>}
                {row.lastError && <span style={{ color: 'var(--red)' }}>{row.lastError}</span>}
              </div>

              <div className="row wrap mt" style={{ gap: 8 }}>
                {!connected ? (
                  <>
                    <button className="btn primary sm" onClick={() => connect(row.provider)} disabled={busy === row.provider}>
                      {busy === row.provider ? <span className="spin" /> : row.configured ? 'Connect' : 'Connect (needs .env)'}
                    </button>
                    <button className="btn sm ghost" onClick={() => connect(row.provider, true)} disabled={busy === row.provider} title="Dev only: mark connected without real OAuth">
                      Simulate connect
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn sm" onClick={() => sync(row.provider)} disabled={busy === row.provider}>
                      {busy === row.provider ? <span className="spin" /> : 'Sync now'}
                    </button>
                    <button className="btn sm danger" onClick={() => disconnect(row.provider)} disabled={busy === row.provider}>
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
