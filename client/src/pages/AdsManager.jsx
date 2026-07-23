import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client.js';

// Campaign Architect: give a goal → Rocky drafts copy + targeting → creates the
// campaign in Meta as PAUSED → you review & launch in Ads Manager.
export default function AdsManager() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState(500);
  const [link, setLink] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [pageId, setPageId] = useState('');
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/clients').then(({ data }) => {
      const list = data.clients || data || [];
      setClients(list);
      const skyup = list.find((c) => /skyup/i.test(c.name));
      const chosen = skyup || list[0];
      if (chosen) {
        setClientId(chosen._id || chosen.id);
        if (chosen.website) setLink(chosen.website);
      }
    }).catch(() => {});
  }, []);

  const draft = async () => {
    setErr(''); setResult(null); setDrafting(true);
    try {
      const { data } = await api.post('/ads/draft', { clientId, goal, dailyBudgetInr: Number(budget) || 500 });
      setPlan(data.plan);
    } catch (e) { setErr(apiError(e)); } finally { setDrafting(false); }
  };

  const create = async () => {
    setErr(''); setCreating(true);
    try {
      const { data } = await api.post('/ads/create', {
        clientId, plan, link, imageUrl: imageUrl || undefined, pageId: pageId || undefined,
      });
      setResult(data.result);
    } catch (e) { setErr(apiError(e)); } finally { setCreating(false); }
  };

  const setCopy = (k, v) => setPlan((p) => ({ ...p, adCopy: { ...p.adCopy, [k]: v } }));

  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ marginBottom: 4 }}>Campaign Architect</h2>
      <p className="small muted" style={{ marginBottom: 18 }}>
        Give a goal. Rocky writes the copy + targeting and builds the campaign in Meta <strong>paused</strong> — you review &amp; launch in Ads Manager. Nothing spends until you press Publish there.
      </p>

      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 14 }}>{err}</div>}

      {/* Step 1 — goal */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Client</label>
            <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => <option key={c._id || c.id} value={c._id || c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Daily budget (₹)</label>
            <input className="input" type="number" min={100} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Goal</label>
          <textarea className="textarea" rows={2} placeholder="e.g. Get interior-design consultation leads in Bengaluru for kitchen remodels" value={goal} onChange={(e) => setGoal(e.target.value)} />
        </div>
        <button className="btn primary" onClick={draft} disabled={drafting || !clientId || goal.trim().length < 3}>
          {drafting ? 'Rocky is drafting…' : '✍️ Draft campaign'}
        </button>
      </div>

      {/* Step 2 — review plan */}
      {plan && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 10 }}>Review &amp; adjust</h3>
          <div className="field"><label>Campaign name</label>
            <input className="input" value={plan.campaignName || ''} onChange={(e) => setPlan({ ...plan, campaignName: e.target.value })} /></div>

          <div className="small muted" style={{ margin: '4px 0 10px' }}>
            Targeting: {plan.targeting?.ageMin}-{plan.targeting?.ageMax}, {plan.targeting?.genders || 'all'}, {(plan.targeting?.countries || ['IN']).join(', ')}
            {plan.targeting?.suggestedInterests?.length ? ` · interests to add in Ads Manager: ${plan.targeting.suggestedInterests.join(', ')}` : ''}
          </div>

          <div className="field"><label>Primary text</label>
            <textarea className="textarea" rows={3} value={plan.adCopy?.primaryText || ''} onChange={(e) => setCopy('primaryText', e.target.value)} /></div>
          <div className="row" style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label>Headline</label>
              <input className="input" value={plan.adCopy?.headline || ''} onChange={(e) => setCopy('headline', e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label>Description</label>
              <input className="input" value={plan.adCopy?.description || ''} onChange={(e) => setCopy('description', e.target.value)} /></div>
          </div>

          <div className="row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Destination link *</label>
              <input className="input" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} /></div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Creative image URL (you pick)</label>
              <input className="input" placeholder="https://…jpg  (optional)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} /></div>
          </div>
          <div className="field"><label>Facebook Page ID (if not saved on client)</label>
            <input className="input" placeholder="optional" value={pageId} onChange={(e) => setPageId(e.target.value)} /></div>

          <button className="btn primary" onClick={create} disabled={creating || !link}>
            {creating ? 'Creating in Meta (paused)…' : '🚀 Create campaign (PAUSED)'}
          </button>
        </div>
      )}

      {/* Step 3 — result */}
      {result && (
        <div className="card" style={{ borderColor: 'var(--green, #3dd68c)' }}>
          <h3 style={{ color: 'var(--green, #3dd68c)' }}>✅ Campaign created — PAUSED</h3>
          <div className="small" style={{ margin: '8px 0' }}>Campaign, ad set, creative and ad are all built and paused. Review targeting/budget, then hit Publish in Ads Manager to go live.</div>
          <div className="small muted mono" style={{ marginBottom: 10 }}>campaign: {result.campaignId} · adset: {result.adSetId} · ad: {result.adId}</div>
          <a className="btn primary" href={result.adsManagerUrl} target="_blank" rel="noreferrer">Open in Ads Manager →</a>
        </div>
      )}
    </div>
  );
}