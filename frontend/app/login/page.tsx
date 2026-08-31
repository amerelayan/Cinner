"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
      fetch("http://localhost:8000/favorites", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch("http://localhost:8000/profile", {
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
    <main style={{ padding: 24, maxWidth: 320 }}>
      <h1>Log in</h1>
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
        <br />
        <button type="submit">Log in</button>
      </form>
      {message && <p>{message}</p>}
    </main>
  );
}
