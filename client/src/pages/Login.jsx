import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth.jsx';

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = await login(email.trim(), password);
    setBusy(false);
    if (res.ok) navigate('/');
    else setError(res.error);
  };

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">Rocky</div>
            <div className="brand-sub">Skyup Operating Assistant</div>
          </div>
        </div>
        <p className="muted small" style={{ textAlign: 'center', marginTop: -6 }}>
          Sign in to your Skyup workspace
        </p>
        <form onSubmit={submit} style={{ marginTop: 18 }}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@skyup.test" />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <div className="missing-note" style={{ marginBottom: 12 }}>{error}</div>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? <span className="spin" /> : 'Sign in'}
          </button>
        </form>
        <div className="divider" />
        <div className="small muted" style={{ textAlign: 'center' }}>
          Demo (after <span className="mono">npm run seed</span>):<br />
          <span className="mono">admin@skyup.test</span> / <span className="mono">RockyDemo#2026</span>
        </div>
      </div>
    </div>
  );
}
