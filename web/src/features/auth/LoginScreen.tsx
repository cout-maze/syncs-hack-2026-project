import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";

export function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@city.dev");
  const [password, setPassword] = useState("rebuild-city");
  const [displayName, setDisplayName] = useState("Sam");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    }
  }

  return (
    <main className="auth">
      <p className="eyebrow">Rebuild My City</p>
      <h1>{mode === "login" ? "Sign in" : "Create an account"}</h1>
      <p>Email + password, JWT for 24h. Demo: demo@city.dev / rebuild-city</p>
      <form onSubmit={submit}>
        {mode === "register" ? (
          <label>
            Display name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        ) : null}
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="primary">
          {mode === "login" ? "Log in" : "Register"}
        </button>
      </form>
      <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account?" : "Already have an account?"}
      </button>
    </main>
  );
}
