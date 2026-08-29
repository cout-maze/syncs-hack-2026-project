import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "../api/client";

export type User = { id: string; email: string; displayName: string; createdAt: string };

type AuthState = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("rmc-unauthorized", onUnauthorized);
    (async () => {
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        setUser(await api<User>("/auth/me"));
      } catch {
        setToken(null);
      } finally {
        setReady(true);
      }
    })();
    return () => window.removeEventListener("rmc-unauthorized", onUnauthorized);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      login: async (email, password) => {
        const result = await api<{ token: string; user: User }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setToken(result.token);
        setUser(result.user);
      },
      register: async (email, password, displayName) => {
        const result = await api<{ token: string; user: User }>("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName }),
        });
        setToken(result.token);
        setUser(result.user);
      },
      logout: () => {
        setToken(null);
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
