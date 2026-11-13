import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { TOKEN_KEY, unwrap } from '../api/client';
import { connectSocket, disconnectSocket } from '../api/socket';
import { useToast } from './ToastContext';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));

  const startSession = useCallback((token, nextUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    setUser(nextUser);
    setSocket(connectSocket(token));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    disconnectSocket();
    setSocket(null);
    setUser(null);
  }, []);

  // Persistent login: restore the session from the stored JWT on first load
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    api
      .get('/auth/me')
      .then((res) => startSession(token, unwrap(res).user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, [startSession]);

  // Fired by the axios interceptor on 401 (expired or revoked token)
  useEffect(() => {
    const onExpired = () => {
      if (!localStorage.getItem(TOKEN_KEY)) return;
      logout();
      toast.info('Your session expired. Please log in again.');
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout, toast]);

  const login = useCallback(async (email, password) => {
    const data = unwrap(await api.post('/auth/login', { email, password }));
    startSession(data.token, data.user);
  }, [startSession]);

  const register = useCallback(async (name, email, password) => {
    const data = unwrap(await api.post('/auth/register', { name, email, password }));
    startSession(data.token, data.user);
  }, [startSession]);

  const value = useMemo(() => ({ user, setUser, socket, loading, login, register, logout }), [user, socket, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
