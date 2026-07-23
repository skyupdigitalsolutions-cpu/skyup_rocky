import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client.js';
import { Loader, Chip } from '../components/ui.jsx';
import { useAuth } from '../store/auth.jsx';

export default function Settings() {
  const { can, user } = useAuth();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member', assignedClients: [] });
  const [saving, setSaving] = useState(false);

  const canManage = can('user:manage');

  const load = async () => {
    setLoading(true);
    try {
      const reqs = [api.get('/clients')];
      if (canManage) reqs.push(api.get('/users'), api.get('/insights/audit/logs'));
      const [c, u, l] = await Promise.all(reqs);
      setClients(c.data.clients || []);
      if (u) setUsers(u.data.users || []);
      if (l) setLogs(l.data.logs || []);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createUser = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/users', form);
      setForm({ name: '', email: '', password: '', role: 'member', assignedClients: [] });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { isActive: !u.isActive });
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  if (loading) return <Loader />;

  if (!canManage) {
    return (
      <div className="card">
        <h3>Settings</h3>
        <div className="muted small mt-sm">You’re signed in as <strong>{user?.email}</strong> (team member). User management, roles, and audit logs are available to admins.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="row mb" style={{ gap: 8 }}>
        {['users', 'audit'].map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : 'ghost'}`} onClick={() => setTab(t)}>
            {t === 'users' ? 'Users & roles' : 'Audit log'}
          </button>
        ))}
      </div>

      {error && <div className="missing-note mb">{error}</div>}

      {tab === 'users' && (
        <>
          <div className="row between mb">
            <div className="section-title" style={{ margin: 0 }}>Team members</div>
            <button className="btn primary sm" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ Add user'}</button>
          </div>

          {showForm && (
            <div className="card mb">
              <div className="grid cols-2">
                <div className="field"><label>Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="field"><label>Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="field"><label>Temporary password (min 8)</label><input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div className="field"><label>Role</label>
                  <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="member">Team member (scoped)</option>
                    <option value="admin">Admin / Owner (full)</option>
                  </select>
                </div>
              </div>
              {form.role === 'member' && (
                <div className="field">
                  <label>Assigned clients (members only see these)</label>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {clients.map((c) => {
                      const on = form.assignedClients.includes(c._id);
                      return (
                        <button
                          key={c._id}
                          className={`btn sm ${on ? 'primary' : 'ghost'}`}
                          onClick={() =>
                            setForm({
                              ...form,
                              assignedClients: on ? form.assignedClients.filter((x) => x !== c._id) : [...form.assignedClients, c._id],
                            })
                          }
                        >
                          {c.name}
                        </button>
                      );
                    })}
                    {clients.length === 0 && <span className="muted small">No clients to assign yet.</span>}
                  </div>
                </div>
              )}
              <button className="btn primary" onClick={createUser} disabled={saving || !form.name || !form.email || form.password.length < 8}>
                {saving ? <span className="spin" /> : 'Create user'}
              </button>
            </div>
          )}

          <div className="panel">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Scope</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td className="muted">{u.email}</td>
                    <td><Chip tone={u.role === 'admin' ? 'accent' : 'default'}>{u.role}</Chip></td>
                    <td className="muted small">{u.role === 'admin' ? 'All clients' : `${(u.assignedClients || []).length} clients`}</td>
                    <td><Chip tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Disabled'}</Chip></td>
                    <td style={{ textAlign: 'right' }}>
                      {u.id !== user.id && (
                        <button className="btn sm ghost" onClick={() => toggleActive(u)}>{u.isActive ? 'Disable' : 'Enable'}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'audit' && (
        <div className="panel">
          <table className="table">
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>No audit entries yet.</td></tr>
              ) : (
                logs.map((l) => (
                  <tr key={l._id}>
                    <td className="small muted mono">{new Date(l.createdAt).toLocaleString()}</td>
                    <td className="small">{l.actorEmail || '—'}</td>
                    <td><Chip>{l.action}</Chip></td>
                    <td className="small muted">{l.targetType}{l.targetId ? ` · ${String(l.targetId).slice(0, 10)}` : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
