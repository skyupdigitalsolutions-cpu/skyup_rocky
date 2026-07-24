import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client.js';

// AI media-buyer: goal + budget -> OpenAI strategy (campaign + ad set + ad
// variations) -> AI creative image -> review/tweak -> create everything PAUSED.
export default function AdsManager() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState(500);
  const [link, setLink] = useState('');
  const [pageId, setPageId] = useState('');

  const [plan, setPlan] = useState(null);
  const [adIdx, setAdIdx] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [creativePrompt, setCreativePrompt] = useState('');

  const [drafting, setDrafting] = useState(false);
  const [genImg, setGenImg] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/clients').then(({ data }) => {
      const list = data.clients || data || [];
      setClients(list);
      const skyup = list.find((c) => /skyup/i.test(c.name)) || list[0];
      if (skyup) { setClientId(skyup._id || skyup.id); if (skyup.website) setLink(skyup.website); }
    }).catch(() => {});
  }, []);

  const draft = async () => {
    setErr(''); setResult(null); setPlan(null); setImageUrl(''); setDrafting(true);
    try {
      const { data } = await api.post('/ads/draft', { clientId, goal, dailyBudgetInr: Number(budget) || 500 });
      setPlan(data.plan);
      setAdIdx(0);
      setCreativePrompt(data.plan?.creativePrompt || '');
    } catch (e) { setErr(apiError(e)); } finally { setDrafting(false); }
  };

  const generate = async () => {
    setErr(''); setGenImg(true);
    try {
      const { data } = await api.post('/ads/creative', { clientId, prompt: creativePrompt || goal });
      setImageUrl(data.imageUrl);
    } catch (e) { setErr(apiError(e)); } finally { setGenImg(false); }
  };

  const create = async () => {
    setErr(''); setCreating(true);
    try {
      const chosen = (plan.ads && plan.ads[adIdx]) || plan.adCopy;
      const payload = { clientId, plan: { ...plan, adCopy: chosen }, link, imageUrl: imageUrl || undefined, pageId: pageId || undefined, objective: plan.objective };
      const { data } = await api.post('/ads/create', payload);
      setResult(data.result);
    } catch (e) { setErr(apiError(e)); } finally { setCreating(false); }
  };

  const ads = plan?.ads || (plan?.adCopy ? [plan.adCopy] : []);
  const setAd = (k, v) => {
    const copy = [...ads]; copy[adIdx] = { ...copy[adIdx], [k]: v };
    setPlan({ ...plan, ads: copy });
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <h2 style={{ marginBottom: 4 }}>AI Campaign Architect</h2>
      <p className="small muted" style={{ marginBottom: 18 }}>
        Give a goal — Rocky designs the full campaign (strategy, targeting, ad variations) and generates a creative. Review, tweak, then create it in Meta <strong>paused</strong>. Nothing spends until you publish in Ads Manager.
      </p>

      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 14 }}>{err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
          <label>Campaign goal</label>
          <textarea className="textarea" rows={2} placeholder="e.g. Get consultation leads for modular kitchen remodels in Bengaluru" value={goal} onChange={(e) => setGoal(e.target.value)} />
        </div>
        <button className="btn primary" onClick={draft} disabled={drafting || !clientId || goal.trim().length < 3}>
          {drafting ? 'Rocky is designing the campaign…' : '✨ Design campaign'}
        </button>
      </div>

      {plan && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Strategy</h3>
          <p className="small" style={{ color: 'var(--hud)', marginBottom: 12 }}>{plan.strategy}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div className="field"><label>Campaign name</label>
                <input className="input" value={plan.campaignName || ''} onChange={(e) => setPlan({ ...plan, campaignName: e.target.value })} /></div>
              <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
                <strong>Objective:</strong> {plan.objective || 'OUTCOME_TRAFFIC'}<br />
                <strong>Ad set:</strong> {plan.adSet?.ageMin}-{plan.adSet?.ageMax}, {plan.adSet?.genders || 'all'}, {(plan.adSet?.countries || ['IN']).join(', ')}
                {plan.adSet?.cities?.length ? ` · ${plan.adSet.cities.join(', ')}` : ''}<br />
                <strong>Optimize:</strong> {plan.adSet?.optimizationGoal || 'LINK_CLICKS'} · <strong>Schedule:</strong> {plan.adSet?.schedule || 'continuous'}<br />
                {plan.adSet?.suggestedInterests?.length ? <span><strong>Interests to add in Ads Manager:</strong> {plan.adSet.suggestedInterests.join(', ')}</span> : null}
              </div>

              {ads.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {ads.map((_, i) => (
                    <button key={i} className={`btn sm ${i === adIdx ? 'primary' : 'ghost'}`} onClick={() => setAdIdx(i)}>Variation {i + 1}</button>
                  ))}
                </div>
              )}
              <div className="field"><label>Primary text</label>
                <textarea className="textarea" rows={3} value={ads[adIdx]?.primaryText || ''} onChange={(e) => setAd('primaryText', e.target.value)} /></div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="field" style={{ flex: 1 }}><label>Headline</label>
                  <input className="input" value={ads[adIdx]?.headline || ''} onChange={(e) => setAd('headline', e.target.value)} /></div>
                <div className="field" style={{ flex: 1 }}><label>Description</label>
                  <input className="input" value={ads[adIdx]?.description || ''} onChange={(e) => setAd('description', e.target.value)} /></div>
              </div>
            </div>

            <div>
              <label className="small" style={{ display: 'block', marginBottom: 6 }}>Creative</label>
              <div style={{ aspectRatio: '1/1', border: '1px dashed var(--border)', borderRadius: 10, display: 'grid', placeItems: 'center', overflow: 'hidden', background: '#0b1120', marginBottom: 8 }}>
                {imageUrl ? <img src={imageUrl} alt="creative" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span className="small muted" style={{ padding: 16, textAlign: 'center' }}>No creative yet — generate one or paste your own image URL.</span>}
              </div>
              <div className="field"><label>Creative prompt (editable)</label>
                <textarea className="textarea" rows={2} value={creativePrompt} onChange={(e) => setCreativePrompt(e.target.value)} /></div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button className="btn primary sm" onClick={generate} disabled={genImg}>{genImg ? 'Generating…' : '🎨 Generate creative'}</button>
              </div>
              <div className="field"><label>…or use your own image URL</label>
                <input className="input" placeholder="https://…jpg" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} /></div>
            </div>
          </div>

          <div className="divider" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Destination link *</label>
              <input className="input" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} /></div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Facebook Page ID (if not on client)</label>
              <input className="input" placeholder="optional" value={pageId} onChange={(e) => setPageId(e.target.value)} /></div>
          </div>

          <button className="btn primary" onClick={create} disabled={creating || !link}>
            {creating ? 'Creating in Meta (paused)…' : '🚀 Create campaign (PAUSED)'}
          </button>
        </div>
      )}

      {result && (
        <div className="card" style={{ borderColor: 'var(--green, #3dd68c)' }}>
          <h3 style={{ color: 'var(--green, #3dd68c)' }}>✅ Campaign created — PAUSED</h3>
          <div className="small muted mono" style={{ margin: '8px 0' }}>campaign: {result.campaignId} · adset: {result.adSetId} · ad: {result.adId}</div>
          <a className="btn primary" href={result.adsManagerUrl} target="_blank" rel="noreferrer">Open in Ads Manager to review &amp; publish →</a>
        </div>
      )}
    </div>
  );
}