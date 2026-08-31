"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";

type Favorite = { tmdb_id: number; title: string; poster_path: string | null };
type SearchResult = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};

export default function EditFavoritesPage() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState("");

  async function loadFavorites() {
    const token = await getAccessToken();
    if (!token) {
      setMessage("Please log in.");
      return;
    }
    const res = await fetch("http://localhost:8000/favorites", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setMessage("Failed to load favorites.");
      return;
    }
    const data = await res.json();
    setFavorites(data.favorites);
  }

  useEffect(() => {
    loadFavorites();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const res = await fetch(
        `http://localhost:8000/movies/search?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.results);
    }, 400);
    return () => clearTimeout(timeout);
  }, [query]);

  async function handleRemove(tmdbId: number) {
    setMessage("");
    const token = await getAccessToken();
    if (!token) return;
    await fetch(`http://localhost:8000/favorites/${tmdbId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await loadFavorites();
  }

  async function handleAdd(tmdbId: number) {
    setMessage("");
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("http://localhost:8000/favorites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tmdb_id: tmdbId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body.detail ?? "Failed to add favorite.");
      return;
    }
    await loadFavorites();
  }

  const isFavorite = (tmdbId: number) => favorites.some((f) => f.tmdb_id === tmdbId);

  return (
    <main style={{ padding: 24, maxWidth: 480 }}>
      <h1>Edit Favorites</h1>
      <p>
        {favorites.length}/5
      </p>

      <section>
        <h2>Current Favorites</h2>
        {favorites.length === 0 && <p>No favorites yet.</p>}
        {favorites.map((f) => (
          <div key={f.tmdb_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{f.title}</span>
            <button onClick={() => handleRemove(f.tmdb_id)}>Remove</button>
          </div>
        ))}
      </section>

      <section>
        <h2>Search</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a movie"
        />
        {results.map((r) => (
          <div key={r.tmdb_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              {r.title} {r.release_date ? `(${r.release_date.slice(0, 4)})` : ""}
            </span>
            {isFavorite(r.tmdb_id) ? (
              <span>Already a favorite</span>
            ) : (
              <button onClick={() => handleAdd(r.tmdb_id)}>Add</button>
            )}
          </div>
        ))}
      </section>

      {message && <p>{message}</p>}
    </main>
  );
}
