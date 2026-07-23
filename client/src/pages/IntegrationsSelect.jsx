import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Loader, Empty } from '../components/ui.jsx';

// Integrations are per-client, so choose a client first.
export default function IntegrationsSelect() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/clients').then(({ data }) => { setClients(data.clients || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <div>
      <h2 className="mb">Choose a client to manage integrations</h2>
      {clients.length === 0 ? (
        <Empty title="No clients yet" action={<button className="btn primary sm" onClick={() => navigate('/clients')}>Add a client</button>} />
      ) : (
        <div className="grid cols-3">
          {clients.map((c) => (
            <div key={c._id} className="card clickable" style={{ cursor: 'pointer' }} onClick={() => navigate(`/integrations/${c._id}`)}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="muted small mt-sm">{c.industry || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
