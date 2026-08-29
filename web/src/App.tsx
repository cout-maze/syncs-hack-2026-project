import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginScreen } from "./features/auth/LoginScreen";
import { AppShell } from "./features/shell/AppShell";
import "./index.css";

function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return <p className="panel">Starting…</p>;
  return user ? <AppShell /> : <LoginScreen />;
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
