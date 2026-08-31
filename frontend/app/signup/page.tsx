"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const router = useRouter();
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

    router.push("/onboarding");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-8">
        <h1 className="font-display text-2xl text-foreground">Sign up</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-muted">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-muted">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded bg-accent py-2.5 font-display tracking-[0.05em] text-white transition-colors hover:bg-accent-hover"
          >
            Sign up
          </button>
        </form>
        {message && <p className="mt-4 text-sm text-accent">{message}</p>}
      </div>
    </main>
  );
}
