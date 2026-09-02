"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import TrackButton from "@/components/TrackButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import { API_BASE_URL } from "@/lib/api";

type Movie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  match_pct: number;
  predicted_rating: number;
  watched: boolean;
  in_watchlist: boolean;
};

type ForYouResponse = {
  highest_match: Omit<Movie, "watched" | "in_watchlist">[];
  rate_highly: Omit<Movie, "watched" | "in_watchlist">[];
  based_on_favorites: Omit<Movie, "watched" | "in_watchlist">[];
  because_you_liked: { seed_title: string | null; movies: Omit<Movie, "watched" | "in_watchlist">[] };
  hidden_gems: Omit<Movie, "watched" | "in_watchlist">[];
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w300";
const PAGE_SIZE = 5;

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

function MovieCard({
  movie,
  onToggleWatched,
  onToggleWatchlist,
}: {
  movie: Movie;
  onToggleWatched: (movie: Movie) => void;
  onToggleWatchlist: (movie: Movie) => void;
}) {
  return (
    <div className="group relative">
      <Link href={`/movies/${movie.tmdb_id}`} className="relative block">
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
        <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 font-display text-[10px] text-white shadow">
          {movie.match_pct}% MATCH
        </span>
      </Link>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative flex gap-2 pointer-events-auto">
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

      <Link
        href={`/movies/${movie.tmdb_id}`}
        className="relative mt-2 inline-block text-sm text-foreground after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-0 after:bg-accent after:transition-all after:duration-300 hover:after:w-full"
      >
        {movie.title}
        {movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ""}
      </Link>
      <p className="text-xs text-muted">Predicted {movie.predicted_rating}/10</p>
    </div>
  );
}

function MovieRow({
  title,
  movies,
  onToggleWatched,
  onToggleWatchlist,
}: {
  title: string;
  movies: Movie[];
  onToggleWatched: (movie: Movie) => void;
  onToggleWatchlist: (movie: Movie) => void;
}) {
  const [page, setPage] = useState(0);

  if (movies.length === 0) return null;

  const maxPage = Math.max(0, Math.ceil(movies.length / PAGE_SIZE) - 1);
  const visible = movies.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg tracking-wide text-foreground">{title}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label={`Previous ${title}`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={page >= maxPage}
            aria-label={`Next ${title}`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
          >
            <ArrowIcon direction="right" />
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {visible.map((movie) => (
          <MovieCard
            key={movie.tmdb_id}
            movie={movie}
            onToggleWatched={onToggleWatched}
            onToggleWatchlist={onToggleWatchlist}
          />
        ))}
      </div>
    </section>
  );
}

function withDefaults(movies: Omit<Movie, "watched" | "in_watchlist">[]): Movie[] {
  return movies.map((m) => ({ ...m, watched: false, in_watchlist: false }));
}

export default function ForYouPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [highestMatch, setHighestMatch] = useState<Movie[]>([]);
  const [rateHighly, setRateHighly] = useState<Movie[]>([]);
  const [basedOnFavorites, setBasedOnFavorites] = useState<Movie[]>([]);
  const [becauseYouLiked, setBecauseYouLiked] = useState<{ seedTitle: string | null; movies: Movie[] }>({
    seedTitle: null,
    movies: [],
  });
  const [hiddenGems, setHiddenGems] = useState<Movie[]>([]);

  useEffect(() => {
    async function init() {
      const t = await getAccessToken();
      setToken(t);
      if (!t) {
        setLoading(false);
        return;
      }
      const res = await fetch(`${API_BASE_URL}/for-you`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        setError("Couldn't load recommendations right now.");
        setLoading(false);
        return;
      }
      const data: ForYouResponse = await res.json();
      setHighestMatch(withDefaults(data.highest_match));
      setRateHighly(withDefaults(data.rate_highly));
      setBasedOnFavorites(withDefaults(data.based_on_favorites));
      setBecauseYouLiked({
        seedTitle: data.because_you_liked.seed_title,
        movies: withDefaults(data.because_you_liked.movies),
      });
      setHiddenGems(withDefaults(data.hidden_gems));
      setLoading(false);
    }
    init();
  }, []);

  function patchMovie(tmdbId: number, patch: Partial<Movie>) {
    const updater = (prev: Movie[]) =>
      prev.map((m) => (m.tmdb_id === tmdbId ? { ...m, ...patch } : m));
    setHighestMatch(updater);
    setRateHighly(updater);
    setBasedOnFavorites(updater);
    setBecauseYouLiked((prev) => ({ ...prev, movies: updater(prev.movies) }));
    setHiddenGems(updater);
  }

  async function toggleWatched(movie: Movie) {
    if (!token) return;
    const wasWatched = movie.watched;
    patchMovie(movie.tmdb_id, { watched: !wasWatched });
    const res = wasWatched
      ? await fetch(`${API_BASE_URL}/watched/${movie.tmdb_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch(`${API_BASE_URL}/watched`, {
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
      ? await fetch(`${API_BASE_URL}/watchlist/${movie.tmdb_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch(`${API_BASE_URL}/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tmdb_id: movie.tmdb_id }),
        });
    if (!res.ok) patchMovie(movie.tmdb_id, { in_watchlist: wasInWatchlist });
  }

  if (!token && !loading) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted">
          <Link href="/login" className="text-accent hover:underline">
            Log in
          </Link>{" "}
          to see recommendations picked for you.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-10 sm:px-6">
      <h1 className="font-display text-2xl text-foreground sm:text-3xl">For You</h1>

      {loading && (
        <LoadingSpinner
          size="lg"
          label="Building your recommendations — this looks at your ratings, favorites, and preferences, so it can take a few seconds..."
        />
      )}

      {error && <p className="mt-6 text-sm text-accent">{error}</p>}

      {!loading && !error && (
        <>
          <MovieRow
            title="🔥 Highest Match"
            movies={highestMatch}
            onToggleWatched={toggleWatched}
            onToggleWatchlist={toggleWatchlist}
          />
          <MovieRow
            title="⭐ Movies You'd Rate Highly"
            movies={rateHighly}
            onToggleWatched={toggleWatched}
            onToggleWatchlist={toggleWatchlist}
          />
          <MovieRow
            title="🎬 Based on Your Favorites"
            movies={basedOnFavorites}
            onToggleWatched={toggleWatched}
            onToggleWatchlist={toggleWatchlist}
          />
          <MovieRow
            title={
              becauseYouLiked.seedTitle
                ? `👀 Because You Liked ${becauseYouLiked.seedTitle}`
                : "👀 Because You Liked..."
            }
            movies={becauseYouLiked.movies}
            onToggleWatched={toggleWatched}
            onToggleWatchlist={toggleWatchlist}
          />
          <MovieRow
            title="Hidden Gems"
            movies={hiddenGems}
            onToggleWatched={toggleWatched}
            onToggleWatchlist={toggleWatchlist}
          />

          {[highestMatch, rateHighly, basedOnFavorites, becauseYouLiked.movies, hiddenGems].every(
            (list) => list.length === 0
          ) && (
            <p className="mt-6 text-sm text-muted">
              Not enough data yet — rate a few more movies or add some favorites, then check back.
            </p>
          )}
        </>
      )}
    </main>
  );
}
