import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiError } from '../api/client.js';
import { Loader, Empty, Chip } from '../components/ui.jsx';
import { useAuth } from '../store/auth.jsx';

export default function Clients() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', industry: '', website: '', goals: '' });
  const [saving, setSaving] = useState(false);

  const load = async (query = '') => {
    setLoading(true);
    try {
      const { data } = await api.get('/clients', { params: query ? { q: query } : {} });
      setClients(data.clients || []);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/clients', { ...form, status: 'active' });
      setShowForm(false);
      setForm({ name: '', industry: '', website: '', goals: '' });
      navigate(`/clients/${data.client._id}`);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="row between mb">
        <div className="row" style={{ gap: 10 }}>
          <input
            className="input"
            style={{ width: 280 }}
            placeholder="Search clients…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(q)}
          />
          <button className="btn sm" onClick={() => load(q)}>Search</button>
        </div>
        {can('client:write') && (
          <button className="btn primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ New client'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="card mb">
          <h3 className="mb">New client</h3>
          <div className="grid cols-2">
            <div className="field"><label>Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Industry</label><input className="input" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></div>
            <div className="field"><label>Website</label><input className="input" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
            <div className="field"><label>Primary goal</label><input className="input" value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} /></div>
          </div>
          <button className="btn primary" onClick={create} disabled={saving || !form.name.trim()}>
            {saving ? <span className="spin" /> : 'Create client'}
          </button>
        </div>
      )}

      {error && <div className="missing-note mb">{error}</div>}

      {loading ? (
        <Loader />
      ) : clients.length === 0 ? (
        <Empty title="No clients found" hint="Create your first client to start building its brain." />
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Industry</th>
                <th>Status</th>
                <th>Services</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c._id} className="clickable" onClick={() => navigate(`/clients/${c._id}`)}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="muted">{c.industry || '—'}</td>
                  <td><Chip tone={c.status === 'active' ? 'green' : 'default'}>{c.status}</Chip></td>
                  <td className="muted">{(c.services || []).map((s) => s.name).join(', ') || '—'}</td>
                  <td style={{ textAlign: 'right' }} className="muted">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
