"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setMessage(`Signup failed: ${error.message}`);
      return;
    }

    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setMessage(
        "Account created, but no session token was returned (check email confirmation settings)."
      );
      return;
    }

    const res = await fetch("http://localhost:8000/profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ username }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(`Account created, but profile setup failed: ${body.detail ?? res.statusText}`);
      return;
    }

    setMessage("Signup successful!");
  }

  return (
    <main style={{ padding: 24, maxWidth: 320 }}>
      <h1>Sign up</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Email</label>
          <br />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Password</label>
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Username</label>
          <br />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <br />
        <button type="submit">Sign up</button>
      </form>
      {message && <p>{message}</p>}
    </main>
  );
}
