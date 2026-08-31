"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import RatingBadge from "@/components/RatingBadge";

type MovieDetail = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  synopsis: string | null;
  director: string | null;
  genres: string[] | null;
  main_cast: string[] | null;
  language: string | null;
  runtime_minutes: number | null;
  imdb_rating: number | null;
  rotten_tomatoes_rating: number | null;
  letterboxd_rating: number | null;
  cinner_average_rating: number | null;
  cinner_ratings_count: number;
  your_rating: number | null;
  watched: boolean;
  in_watchlist: boolean;
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w400";
const RATING_OPTIONS = Array.from({ length: 19 }, (_, i) => 1 + i * 0.5);

const ACTION_BUTTON =
  "rounded border border-border px-4 py-2 text-sm tracking-wide text-foreground transition-colors hover:border-accent";
const ACTION_BUTTON_ACTIVE =
  "rounded border border-accent bg-accent/10 px-4 py-2 text-sm tracking-wide text-accent transition-colors hover:bg-accent/20";

export default function MovieDetailPage() {
  const params = useParams<{ id: string }>();
  const tmdbId = params.id;

  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [ratingChoice, setRatingChoice] = useState<string>("");
  const [message, setMessage] = useState("");

  async function load() {
    const currentToken = await getAccessToken();
    setToken(currentToken);
    const headers: Record<string, string> = {};
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

    const res = await fetch(`http://localhost:8000/movies/${tmdbId}`, { headers });
    if (!res.ok) {
      setError("Failed to load movie.");
      return;
    }
    const data: MovieDetail = await res.json();
    setMovie(data);
    setRatingChoice(data.your_rating !== null ? String(data.your_rating) : "");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  async function handleRate() {
    if (!token || !ratingChoice) return;
    setMessage("");
    const res = await fetch("http://localhost:8000/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tmdb_id: Number(tmdbId), rating: Number(ratingChoice) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body.detail ?? "Failed to submit rating.");
      return;
    }
    await load();
  }

  async function handleClearRating() {
    if (!token) return;
    setMessage("");
    await fetch(`http://localhost:8000/ratings/${tmdbId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await load();
  }

  async function toggleWatched() {
    if (!token || !movie) return;
    if (movie.watched) {
      await fetch(`http://localhost:8000/watched/${tmdbId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } else {
      await fetch("http://localhost:8000/watched", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tmdb_id: Number(tmdbId) }),
      });
    }
    await load();
  }

  async function toggleWatchlist() {
    if (!token || !movie) return;
    if (movie.in_watchlist) {
      await fetch(`http://localhost:8000/watchlist/${tmdbId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } else {
      await fetch("http://localhost:8000/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tmdb_id: Number(tmdbId) }),
      });
    }
    await load();
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-muted">{error}</p>
      </main>
    );
  }

  if (!movie) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-muted">Loading...</p>
      </main>
    );
  }

  const year = movie.release_date ? movie.release_date.slice(0, 4) : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-8 sm:flex-row">
        <div className="mx-auto w-56 flex-shrink-0 sm:mx-0 sm:w-64">
          {movie.poster_path ? (
            <img
              src={`${POSTER_BASE}${movie.poster_path}`}
              alt={movie.title}
              className="w-full rounded-sm border border-border shadow-lg"
            />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center rounded-sm border border-border bg-surface text-sm text-muted">
              No poster
            </div>
          )}
        </div>

        <div className="flex-1">
          <h1 className="font-display text-2xl leading-tight text-foreground sm:text-3xl">
            {movie.title}
          </h1>
          <p className="mt-2 text-sm tracking-wide text-muted">
            {[
              year,
              movie.genres && movie.genres.length > 0 ? movie.genres.join(", ") : null,
              movie.runtime_minutes ? `${movie.runtime_minutes} min` : null,
              movie.language ? movie.language.toUpperCase() : null,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <RatingBadge source="imdb" value={movie.imdb_rating} suffix="/10" />
            <RatingBadge source="rt" value={movie.rotten_tomatoes_rating} suffix="%" />
            <RatingBadge source="letterboxd" value={movie.letterboxd_rating} suffix="/5" />
            <RatingBadge
              source="cinner"
              value={movie.cinner_average_rating}
              suffix={movie.cinner_ratings_count > 0 ? ` (${movie.cinner_ratings_count})` : ""}
            />
          </div>

          {movie.synopsis && (
            <p className="mt-6 max-w-2xl leading-relaxed text-foreground/90">{movie.synopsis}</p>
          )}

          <div className="mt-6 space-y-2 text-sm">
            <p>
              <span className="text-muted">Director </span>
              <span className="text-foreground">{movie.director ?? "—"}</span>
            </p>
            <p>
              <span className="text-muted">Cast </span>
              <span className="text-foreground">
                {movie.main_cast && movie.main_cast.length > 0 ? movie.main_cast.join(", ") : "—"}
              </span>
            </p>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            {token ? (
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={ratingChoice}
                  onChange={(e) => setRatingChoice(e.target.value)}
                  className="text-sm"
                >
                  <option value="">Rate...</option>
                  {RATING_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button onClick={handleRate} disabled={!ratingChoice} className={ACTION_BUTTON}>
                  Submit
                </button>
                {movie.your_rating !== null && (
                  <button onClick={handleClearRating} className={ACTION_BUTTON}>
                    Clear rating
                  </button>
                )}

                <button
                  onClick={toggleWatched}
                  className={movie.watched ? ACTION_BUTTON_ACTIVE : ACTION_BUTTON}
                >
                  {movie.watched ? "Watched ✓" : "Mark as Watched"}
                </button>

                <button
                  onClick={toggleWatchlist}
                  className={movie.in_watchlist ? ACTION_BUTTON_ACTIVE : ACTION_BUTTON}
                >
                  {movie.in_watchlist ? "On Watchlist ✓" : "Add to Watchlist"}
                </button>

                {message && <p className="w-full text-sm text-accent">{message}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted">
                <Link href="/login" className="text-accent hover:underline">
                  Log in
                </Link>{" "}
                to rate, track, or add this movie to your watchlist.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
