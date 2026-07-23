import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, apiError } from '../api/client.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setPermissions(data.permissions || []);
    } catch {
      setUser(null);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = async (email, password) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setToken(data.token);
      setUser(data.user);
      setPermissions(data.permissions || []);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: apiError(err) };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    setPermissions([]);
  };

  const can = (perm) => permissions.includes(perm);

  return (
    <AuthCtx.Provider value={{ user, permissions, loading, login, logout, can, refresh: loadMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
