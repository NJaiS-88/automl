import { useState } from "react";
import { useAuthStore } from "../authStore";

function AuthPage() {
  const { login, signup, loading, error } = useAuthStore();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode === "login") {
      await login({ email, password });
      return;
    }
    await signup({ name, email, password });
  };

  return (
    <div className="auth-wrap">
      <form className="panel auth-panel" onSubmit={handleSubmit}>
        <h2>{mode === "login" ? "Login" : "Sign Up"}</h2>
        {mode === "signup" && (
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="primary-btn" disabled={loading}>
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Create Account"}
        </button>
        {error && <p className="error-text">{error}</p>}
        <button
          type="button"
          className="secondary-btn switch-btn"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Need an account? Sign Up" : "Already registered? Login"}
        </button>
      </form>
    </div>
  );
}

export default AuthPage;
