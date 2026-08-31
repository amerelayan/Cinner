"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import TrackButton from "@/components/TrackButton";

type Movie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  watched: boolean;
  in_watchlist: boolean;
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w300";

function MovieCard({
  movie,
  showTracking,
  onToggleWatched,
  onToggleWatchlist,
}: {
  movie: Movie;
  showTracking: boolean;
  onToggleWatched: (movie: Movie) => void;
  onToggleWatchlist: (movie: Movie) => void;
}) {
  return (
    <div className="group relative">
      <Link href={`/movies/${movie.tmdb_id}`}>
        {movie.poster_path ? (
          <img
            src={`${POSTER_BASE}${movie.poster_path}`}
            alt={movie.title}
            className="w-full rounded-sm border border-border shadow transition-transform duration-200 group-hover:-translate-y-1"
          />
        ) : (
          <div className="flex aspect-[2/3] w-full items-center justify-center rounded-sm border border-border bg-surface text-xs text-muted">
            {movie.title}
          </div>
        )}
      </Link>

      {showTracking && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative flex gap-2">
            <TrackButton
              icon="eye"
              active={movie.watched}
              inactiveLabel="Watch"
              activeLabel="Watched"
              onClick={() => onToggleWatched(movie)}
            />
            <TrackButton
              icon="bookmark"
              active={movie.in_watchlist}
              inactiveLabel="Watchlist"
              activeLabel="In Watchlist"
              onClick={() => onToggleWatchlist(movie)}
            />
          </div>
        </div>
      )}

      <Link
        href={`/movies/${movie.tmdb_id}`}
        className="relative mt-2 inline-block text-sm text-foreground after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-0 after:bg-accent after:transition-all after:duration-300 hover:after:w-full"
      >
        {movie.title}
        {movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ""}
      </Link>
    </div>
  );
}

export default function SearchPage() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [trending, setTrending] = useState<Movie[]>([]);
  const [results, setResults] = useState<Movie[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);

  useEffect(() => {
    async function init() {
      const t = await getAccessToken();
      setToken(t);
      const headers: Record<string, string> = {};
      if (t) headers.Authorization = `Bearer ${t}`;
      const res = await fetch("http://localhost:8000/movies/trending", { headers });
      if (res.ok) {
        const data = await res.json();
        setTrending(data.trending);
      }
      setLoadingTrending(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(
        `http://localhost:8000/movies/search?q=${encodeURIComponent(query)}`,
        { headers }
      );
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.results);
    }, 400);
    return () => clearTimeout(timeout);
  }, [query, token]);

  function patchMovie(tmdbId: number, patch: Partial<Movie>) {
    setTrending((prev) => prev.map((m) => (m.tmdb_id === tmdbId ? { ...m, ...patch } : m)));
    setResults((prev) => prev.map((m) => (m.tmdb_id === tmdbId ? { ...m, ...patch } : m)));
  }

  async function toggleWatched(movie: Movie) {
    if (!token) return;
    const wasWatched = movie.watched;
    patchMovie(movie.tmdb_id, { watched: !wasWatched });
    const res = wasWatched
      ? await fetch(`http://localhost:8000/watched/${movie.tmdb_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch("http://localhost:8000/watched", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tmdb_id: movie.tmdb_id }),
        });
    if (!res.ok) patchMovie(movie.tmdb_id, { watched: wasWatched });
  }

  async function toggleWatchlist(movie: Movie) {
    if (!token) return;
    const wasInWatchlist = movie.in_watchlist;
    patchMovie(movie.tmdb_id, { in_watchlist: !wasInWatchlist });
    const res = wasInWatchlist
      ? await fetch(`http://localhost:8000/watchlist/${movie.tmdb_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch("http://localhost:8000/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tmdb_id: movie.tmdb_id }),
        });
    if (!res.ok) patchMovie(movie.tmdb_id, { in_watchlist: wasInWatchlist });
  }

  const isSearching = query.trim().length > 0;
  const shown = isSearching ? results : trending;

  return (
    <main className="flex flex-1 flex-col items-center px-4 pb-16 pt-16 sm:pt-20">
      <div className="w-full max-w-xl">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex w-full overflow-hidden rounded border border-border bg-surface shadow-2xl"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for movies..."
            className="flex-1 rounded-none border-none bg-transparent px-4 py-3 text-foreground placeholder:text-muted focus:outline-none"
          />
        </form>
      </div>

      <section className="mt-12 w-full max-w-6xl">
        <h2 className="font-display text-lg tracking-wide text-foreground">
          {isSearching ? `Results for "${query}"` : "Trending Today"}
        </h2>

        {!isSearching && loadingTrending && (
          <p className="mt-5 text-sm text-muted">Loading...</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {shown.map((movie) => (
            <MovieCard
              key={movie.tmdb_id}
              movie={movie}
              showTracking={!!token}
              onToggleWatched={toggleWatched}
              onToggleWatchlist={toggleWatchlist}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
