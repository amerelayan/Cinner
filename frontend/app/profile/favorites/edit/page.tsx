"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import FavoritesPicker from "@/components/FavoritesPicker";

type Favorite = { tmdb_id: number; title: string; poster_path: string | null };
type SearchResult = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};

export default function EditFavoritesPage() {
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-foreground sm:text-3xl">Edit Favorites</h1>
        <Link
          href="/profile"
          className="relative text-sm text-muted transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-0 after:bg-accent after:transition-all after:duration-300 hover:after:w-full"
        >
          Back to Profile
        </Link>
      </div>

      {favorites === null ? (
        <p className="mt-6 text-sm text-muted">{message || "Loading..."}</p>
      ) : (
        <div className="mt-8 rounded border border-border bg-surface p-6 sm:p-8">
          <p className="mb-4 text-center text-sm text-muted">{favorites.length}/5 selected</p>
          <FavoritesPicker
            favorites={favorites}
            query={query}
            onQueryChange={setQuery}
            results={results}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
          {message && <p className="mt-4 text-center text-sm text-accent">{message}</p>}
        </div>
      )}
    </main>
  );
}
