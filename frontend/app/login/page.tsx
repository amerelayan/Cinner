"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { API_BASE_URL } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(`Login failed: ${error.message}`);
      return;
    }

    const accessToken = data.session?.access_token;
    const [favRes, profRes] = await Promise.all([
      fetch(`${API_BASE_URL}/favorites`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch(`${API_BASE_URL}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);
    const favData = await favRes.json();
    const profData = await profRes.json();

    const onboardingComplete =
      favData.favorites.length === 5 &&
      profData.preferred_genres !== null &&
      profData.preferred_movie_age !== null &&
      profData.prefers_imdb_top_250 !== null;

    router.push(onboardingComplete ? "/profile" : "/onboarding");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-8">
        <h1 className="font-display text-2xl text-foreground">Log in</h1>
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
          <button
            type="submit"
            className="w-full rounded bg-accent py-2.5 font-display tracking-[0.05em] text-white transition-colors hover:bg-accent-hover"
          >
            Log in
          </button>
        </form>
        {message && <p className="mt-4 text-sm text-accent">{message}</p>}
      </div>
    </main>
  );
}
