"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PosterWall from "@/components/PosterWall";

type FeaturedMovie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  tmdb_rating: number | null;
};

export default function Home() {
  const router = useRouter();
  const [movies, setMovies] = useState<FeaturedMovie[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("http://localhost:8000/movies/featured")
      .then((res) => (res.ok ? res.json() : { movies: [] }))
      .then((data) => setMovies(data.movies ?? []))
      .catch(() => setMovies([]));
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
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
        <h1 className="font-display text-4xl tracking-[0.2em] text-foreground sm:text-5xl">
          CINNER
        </h1>
        <p className="mt-2 text-xs tracking-[0.35em] text-muted sm:text-sm">
          WATCH. RATE. REMEMBER.
        </p>

        <form
          onSubmit={handleSearch}
          className="pointer-events-auto mt-10 flex w-full max-w-xl overflow-hidden rounded border border-border bg-surface/95 shadow-2xl"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for movies..."
            className="flex-1 rounded-none border-none bg-transparent px-4 py-3 text-foreground placeholder:text-muted focus:outline-none"
          />
          <button
            type="submit"
            className="bg-accent px-6 py-3 text-sm font-medium tracking-wide text-white transition-colors hover:bg-accent-hover"
          >
            SEARCH
          </button>
        </form>

        <div className="mt-14 flex items-center gap-4 text-xs tracking-[0.25em] text-muted">
          <span className="h-px w-10 bg-border" />
          <span>MOVIES STAY. MEMORIES LAST.</span>
          <span className="h-px w-10 bg-border" />
        </div>
      </div>

      <footer className="pointer-events-none relative z-20 w-full border-t border-border px-4 py-6 text-center text-xs tracking-wide text-muted">
        <p>BUILT FOR MOVIE LOVERS.</p>
        <p className="mt-1">© {new Date().getFullYear()} CINNER</p>
      </footer>
    </main>
  );
}
