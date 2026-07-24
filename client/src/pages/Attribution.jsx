import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client.js';

// The money view: Meta spend joined to CRM leads + conversions, per ad set.
export default function Attribution() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async (d) => {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get(`/metrics/attribution?days=${d}`);
      setData(data);
    } catch (e) { setErr(apiError(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(days); }, [days]);

  const inr = (n) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2>Campaign Attribution</h2>
        <select className="select" style={{ width: 160 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <p className="small muted" style={{ marginBottom: 18 }}>
        Meta spend joined to your CRM leads &amp; conversions per ad set — the real cost per lead and per conversion.
      </p>

      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{err}</div>}
      {loading && <div className="card">Loading…</div>}

      {!loading && data?.note && <div className="card" style={{ color: 'var(--amber)' }}>{data.note}</div>}
      {!loading && data?.metaError && <div className="card" style={{ color: 'var(--red)' }}>Meta: {data.metaError}</div>}

      {!loading && data?.totals && (
        <>
          <div className="cc-panel cc-stats" style={{ marginBottom: 16 }}>
            <div className="cc-stat"><div className="v">{inr(data.totals.spend)}</div><div className="l">Total Spend</div></div>
            <div className="cc-stat"><div className="v">{data.totals.leads}</div><div className="l">Leads</div></div>
            <div className="cc-stat"><div className="v">{data.totals.conversions}</div><div className="l">Conversions</div></div>
            <div className="cc-stat hud"><div className="v">{inr(data.totals.costPerLead)}</div><div className="l">Cost / Lead</div></div>
            <div className="cc-stat hud"><div className="v">{inr(data.totals.costPerConversion)}</div><div className="l">Cost / Conversion</div></div>
          </div>

          {data.bestAdSet && (
            <div className="card" style={{ borderColor: 'var(--green)', marginBottom: 16 }}>
              🏆 <strong>Best converting ad set:</strong> {data.bestAdSet.adSet} — {inr(data.bestAdSet.costPerConversion)}/conversion
              ({data.bestAdSet.conversions} conversions from {data.bestAdSet.leads} leads). Consider shifting budget here.
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="cc-tbl" style={{ width: '100%' }}>
              <thead><tr>
                <th style={{ textAlign: 'left' }}>Ad set</th><th>Spend</th><th>Leads</th><th>Conv.</th>
                <th>Cost/Lead</th><th>Cost/Conv.</th><th>Conv%</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} style={{ opacity: r.linked ? 1 : 0.6 }}>
                    <td style={{ textAlign: 'left' }}>{r.adSet}{!r.linked && <span className="small muted"> (no spend link)</span>}</td>
                    <td>{inr(r.spend)}</td>
                    <td>{r.leads}</td>
                    <td className="g">{r.conversions}</td>
                    <td>{inr(r.costPerLead)}</td>
                    <td className="g">{inr(r.costPerConversion)}</td>
                    <td>{r.convRate}%</td>
                  </tr>
                ))}
                {!data.rows.length && <tr><td colSpan={7} className="small muted" style={{ padding: 20 }}>No attributed data in this window.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>
            Rows with "no spend link" are CRM leads whose ad set isn't matched to a Meta ad set ID yet (check the MetaConfig's <code>metaAdsetId</code>).
          </div>
        </>
      )}
    </div>
  );
}