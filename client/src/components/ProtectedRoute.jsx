import { Navigate } from 'react-router-dom';
import { useAuth } from '../store/auth.jsx';
import { Loader } from './ui.jsx';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="login-shell"><Loader label="Starting Rocky…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
