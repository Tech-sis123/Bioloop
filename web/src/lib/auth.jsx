import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post, refreshSession, setAccessToken, setSessionEndHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // On load, try to resume the session from the refresh cookie
  useEffect(() => {
    setSessionEndHandler(() => {
      setAccessToken(null);
      setUser(null);
    });
    refreshSession()
      .then((data) => setUser(data?.user || null))
      .finally(() => setReady(true));
  }, []);

  const accept = useCallback((data) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const login = useCallback(async (email, password) => accept(await post('/auth/login', { email, password })), [accept]);
  const register = useCallback(async (body) => accept(await post('/auth/register', body)), [accept]);
  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* already signed out */ }
    setAccessToken(null);
    setUser(null);
  }, []);
  const reload = useCallback(async () => {
    const { user: u } = await get('/auth/me');
    setUser(u);
    return u;
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, reload, setUser, accept }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
