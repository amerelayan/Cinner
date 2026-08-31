"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type SearchResult = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w200";

export default function SearchPage() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
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
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="font-display text-xl tracking-wide text-foreground">Search</h1>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a movie"
        className="mt-4 w-full max-w-sm"
      />

      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {results.map((r) => (
          <Link key={r.tmdb_id} href={`/movies/${r.tmdb_id}`} className="group">
            {r.poster_path ? (
              <img
                src={`${POSTER_BASE}${r.poster_path}`}
                alt={r.title}
                className="w-full rounded-sm border border-border shadow transition-transform duration-200 group-hover:-translate-y-1"
              />
            ) : (
              <div className="flex aspect-[2/3] w-full items-center justify-center rounded-sm border border-border bg-surface text-xs text-muted">
                {r.title}
              </div>
            )}
            <p className="relative mt-2 inline-block text-sm text-foreground after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-0 after:bg-accent after:transition-all after:duration-300 group-hover:after:w-full">
              {r.title}
              {r.release_date ? ` (${r.release_date.slice(0, 4)})` : ""}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
