import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginInput, RegisterInput, User } from '@rmc/shared';
import { authApi } from '@/lib/api/endpoints';
import { onUnauthorized } from '@/lib/api/client';
import { getToken, setToken } from '@/lib/tokenStore';

/**
 * Auth is deliberately thin: the rest of the app only depends on "there is a bearer
 * token" and the `User` shape. Swapping email/password for OAuth later should not
 * touch anything outside this folder (see specs/auth-service.yaml design note).
 */

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState['status']>(getToken() ? 'loading' : 'anonymous');

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // Any 401 anywhere in the app drops us back to the login screen.
  useEffect(() => {
    onUnauthorized(() => {
      if (getToken()) logout();
    });
    return () => onUnauthorized(null);
  }, [logout]);

  // Rehydrate from a stored token on boot.
  useEffect(() => {
    if (!getToken()) return;
    const controller = new AbortController();
    let cancelled = false;

    authApi
      .me(controller.signal)
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setUser(null);
        setStatus('anonymous');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const adopt = useCallback((response: { token: string; user: User }) => {
    setToken(response.token);
    setUser(response.user);
    setStatus('authenticated');
    return response.user;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      login: (input) => authApi.login(input).then(adopt),
      register: (input) => authApi.register(input).then(adopt),
      logout,
    }),
    [user, status, adopt, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
