"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";

type Favorite = { tmdb_id: number; title: string; poster_path: string | null };

const POSTER_BASE = "https://image.tmdb.org/t/p/w200";

export default function ProfilePage() {
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const token = await getAccessToken();
      if (!token) {
        setError("Please log in to view your profile.");
        return;
      }

      const res = await fetch("http://localhost:8000/favorites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError("Failed to load favorites.");
        return;
      }
      const data = await res.json();
      setFavorites(data.favorites);
    }
    load();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Profile</h1>

      {error && <p>{error}</p>}

      <section>
        <h2>My 5 Favorites</h2>

        {favorites === null && !error && <p>Loading...</p>}

        {favorites && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {favorites.map((f) => (
              <div key={f.tmdb_id} style={{ width: 100 }}>
                {f.poster_path ? (
                  <img
                    src={`${POSTER_BASE}${f.poster_path}`}
                    alt={f.title}
                    style={{ width: "100%" }}
                  />
                ) : (
                  <div style={{ width: 100, height: 150, background: "#ccc" }} />
                )}
                <p>{f.title}</p>
              </div>
            ))}
            {Array.from({ length: Math.max(0, 5 - favorites.length) }).map((_, i) => (
              <div
                key={`empty-${i}`}
                style={{
                  width: 100,
                  height: 150,
                  background: "#eee",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                Empty
              </div>
            ))}
          </div>
        )}

        <p>
          <Link href="/profile/favorites/edit">Edit Favorites</Link>
        </p>
      </section>
    </main>
  );
}
