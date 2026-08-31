"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PosterWall from "@/components/PosterWall";
import FilmReelIcon from "@/components/FilmReelIcon";

type FeaturedMovie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  tmdb_rating: number | null;
};

type SearchResult = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};

const POSTER_THUMB = "https://image.tmdb.org/t/p/w92";

export default function Home() {
  const router = useRouter();
  const [movies, setMovies] = useState<FeaturedMovie[]>([]);
  const [query, setQuery] = useState("");
  const [liveResults, setLiveResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetch("http://localhost:8000/movies/featured")
      .then((res) => (res.ok ? res.json() : { movies: [] }))
      .then((data) => setMovies(data.movies ?? []))
      .catch(() => setMovies([]));
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setLiveResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const res = await fetch(
        `http://localhost:8000/movies/search?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setLiveResults((data.results ?? []).slice(0, 6));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setShowDropdown(false);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <main className="relative flex flex-1 flex-col items-center overflow-hidden bg-background">
      {movies.length > 0 && <PosterWall movies={movies} />}

      {/* Gentle dimming behind the search area so it stays the focal point;
          the search panel's own background handles direct occlusion. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(10,9,8,0.55) 0%, rgba(10,9,8,0.25) 45%, rgba(10,9,8,0.15) 100%)",
        }}
      />

      {/* pointer-events-none so this full-width wrapper doesn't block hover/click on
          posters positioned in the same vertical band, away from the actual form. */}
      <div className="relative z-20 flex w-full flex-1 flex-col items-center justify-center px-4 py-24 pointer-events-none">
        <div className="flex items-center gap-3">
          <FilmReelIcon className="h-8 w-8 text-accent sm:h-10 sm:w-10" />
          <h1 className="font-display text-4xl tracking-[0.2em] text-accent sm:text-5xl">
            CINNER
          </h1>
        </div>
        <p className="mt-2 text-xs tracking-[0.35em] text-muted sm:text-sm">
          WATCH. RATE. REMEMBER.
        </p>

        <div className="pointer-events-auto relative mt-10 w-full max-w-xl">
          <form
            onSubmit={handleSearch}
            className="flex w-full overflow-hidden rounded border border-border bg-surface/95 shadow-2xl"
          >
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Search for movies..."
              className="flex-1 rounded-none border-none bg-transparent px-4 py-3 text-foreground placeholder:text-muted focus:outline-none"
            />
            <button
              type="submit"
              className="bg-accent px-6 py-3 font-display text-sm tracking-[0.1em] text-white transition-colors hover:bg-accent-hover"
            >
              SEARCH
            </button>
          </form>

          {showDropdown && liveResults.length > 0 && (
            <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded border border-border bg-surface shadow-2xl">
              {liveResults.map((r) => (
                <button
                  key={r.tmdb_id}
                  onMouseDown={() => router.push(`/movies/${r.tmdb_id}`)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  {r.poster_path ? (
                    <img
                      src={`${POSTER_THUMB}${r.poster_path}`}
                      alt={r.title}
                      className="h-12 w-8 rounded-sm border border-border object-cover"
                    />
                  ) : (
                    <div className="h-12 w-8 rounded-sm border border-border bg-surface-2" />
                  )}
                  <span className="text-sm text-foreground">
                    {r.title}
                    {r.release_date && (
                      <span className="ml-1 text-muted">({r.release_date.slice(0, 4)})</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-14 flex items-center gap-4 text-xs tracking-[0.25em] text-muted">
          <span className="h-px w-10 bg-border" />
          <span>MOVIES STAY. MEMORIES LAST.</span>
          <span className="h-px w-10 bg-border" />
        </div>
      </div>

      <footer className="pointer-events-none relative z-20 w-full border-t border-border bg-background px-4 py-6 text-center text-xs tracking-wide text-muted">
        <p>BUILT FOR MOVIE LOVERS.</p>
        <p className="mt-1">© {new Date().getFullYear()} CINNER</p>
      </footer>
    </main>
  );
}
