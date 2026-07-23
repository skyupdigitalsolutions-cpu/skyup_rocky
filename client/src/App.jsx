import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import CommandCenter from './pages/CommandCenter.jsx';
import RockyChat from './pages/RockyChat.jsx';
import Clients from './pages/Clients.jsx';
import ClientDetail from './pages/ClientDetail.jsx';
import Integrations from './pages/Integrations.jsx';
import IntegrationsSelect from './pages/IntegrationsSelect.jsx';
import Reels from './pages/Reels.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<CommandCenter />} />
        <Route path="/chat" element={<RockyChat />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/integrations/select" element={<IntegrationsSelect />} />
        <Route path="/integrations/:clientId" element={<Integrations />} />
        <Route path="/reels" element={<Reels />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
