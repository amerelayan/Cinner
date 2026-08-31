"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SearchResult = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w200";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

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

  return (
    <main style={{ padding: 24 }}>
      <h1>Search</h1>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a movie"
        style={{ width: 300 }}
      />

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
        {results.map((r) => (
          <Link
            key={r.tmdb_id}
            href={`/movies/${r.tmdb_id}`}
            style={{ width: 120, color: "inherit", textDecoration: "none" }}
          >
            {r.poster_path ? (
              <img
                src={`${POSTER_BASE}${r.poster_path}`}
                alt={r.title}
                style={{ width: "100%" }}
              />
            ) : (
              <div style={{ width: 120, height: 180, background: "#ccc" }} />
            )}
            <p>
              {r.title}
              {r.release_date ? ` (${r.release_date.slice(0, 4)})` : ""}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
