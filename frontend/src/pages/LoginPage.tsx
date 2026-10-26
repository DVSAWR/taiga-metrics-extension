import { useState, type FormEvent } from "react";

import { ApiError, login, type Me } from "../api";
import { BrandLogo } from "../components/BrandLogo";
import { INDEPENDENT_NOTE } from "../components/Sidebar";

export function LoginPage({
  taigaUrl,
  onSignedIn,
}: {
  taigaUrl: string | null;
  onSignedIn: (me: Me) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await login(username.trim(), password));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Sign-in failed, try again");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-container">
        <BrandLogo className="auth-logo" />
        <h1 className="auth-title">Taiga Metrics</h1>
        <h2 className="auth-tagline">See how your work flows</h2>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Taiga username or email (case sensitive)"
            aria-label="Taiga username or email"
            autoComplete="username"
            autoFocus
            required
          />
          <div className="login-password">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password (case sensitive)"
              aria-label="Password"
              autoComplete="current-password"
              required
            />
            {taigaUrl && (
              <a className="forgot-pass" href={`${taigaUrl}/forgot-password`}>
                Forgot it?
              </a>
            )}
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-button" disabled={busy || !username || !password}>
            {busy ? "Signing in..." : "Login"}
          </button>
        </form>
        <p className="auth-hint">Use the same account you use in Taiga.</p>
        <p className="auth-note">{INDEPENDENT_NOTE}</p>
      </div>
    </div>
  );
}
