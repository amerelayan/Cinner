"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import LoadingSpinner from "@/components/LoadingSpinner";

type Movie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w300";

export default function TrackedMoviesGrid({
  title,
  endpoint,
  responseKey,
  emptyMessage,
}: {
  title: string;
  endpoint: string;
  responseKey: string;
  emptyMessage: string;
}) {
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const token = await getAccessToken();
      if (!token) {
        setError("Please log in to view this page.");
        return;
      }
      const res = await fetch(`http://localhost:8000${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError("Failed to load.");
        return;
      }
      const data = await res.json();
      setMovies(data[responseKey]);
    }
    load();
  }, [endpoint, responseKey]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-foreground sm:text-3xl">{title}</h1>
        <Link
          href="/profile"
          className="relative text-sm text-muted transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-0 after:bg-accent after:transition-all after:duration-300 hover:after:w-full"
        >
          Back to Profile
        </Link>
      </div>

      {error && <p className="mt-6 text-sm text-muted">{error}</p>}

      {!error && movies === null && <LoadingSpinner size="md" />}

      {!error && movies !== null && movies.length === 0 && (
        <p className="mt-6 text-sm text-muted">{emptyMessage}</p>
      )}

      {!error && movies !== null && movies.length > 0 && (
        <div className="mt-8 grid grid-cols-4 gap-2.5 sm:grid-cols-6 sm:gap-3 md:grid-cols-8">
          {movies.map((m) => (
            <Link key={m.tmdb_id} href={`/movies/${m.tmdb_id}`} className="group">
              {m.poster_path ? (
                <img
                  src={`${POSTER_BASE}${m.poster_path}`}
                  alt={m.title}
                  className="w-full rounded-sm border border-border shadow transition-all duration-200 group-hover:-translate-y-1 group-hover:border-accent group-hover:brightness-110"
                />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center rounded-sm border border-border bg-surface-2 p-1 text-center text-[10px] text-muted transition-colors group-hover:border-accent">
                  {m.title}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
