"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import RatingBadge from "@/components/RatingBadge";
import TrackButton from "@/components/TrackButton";
import StarRating from "@/components/StarRating";

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

export default function MovieDetailPage() {
  const params = useParams<{ id: string }>();
  const tmdbId = params.id;

  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
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
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  async function handleRate(rating: number) {
    if (!token || !movie) return;
    setMessage("");
    const previous = movie.your_rating;
    setMovie({ ...movie, your_rating: rating });
    const res = await fetch("http://localhost:8000/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tmdb_id: Number(tmdbId), rating }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body.detail ?? "Failed to submit rating.");
      setMovie((prev) => (prev ? { ...prev, your_rating: previous } : prev));
      return;
    }
    await load();
  }

  async function handleClearRating() {
    if (!token || !movie) return;
    setMessage("");
    const previous = movie.your_rating;
    setMovie({ ...movie, your_rating: null });
    const res = await fetch(`http://localhost:8000/ratings/${tmdbId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setMessage("Failed to clear rating.");
      setMovie((prev) => (prev ? { ...prev, your_rating: previous } : prev));
      return;
    }
    await load();
  }

  async function toggleWatched() {
    if (!token || !movie) return;
    setMessage("");
    const wasWatched = movie.watched;
    setMovie({ ...movie, watched: !wasWatched });
    const res = wasWatched
      ? await fetch(`http://localhost:8000/watched/${tmdbId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch("http://localhost:8000/watched", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tmdb_id: Number(tmdbId) }),
        });
    if (!res.ok) {
      setMessage("Failed to update watched status.");
      setMovie((prev) => (prev ? { ...prev, watched: wasWatched } : prev));
    }
  }

  async function toggleWatchlist() {
    if (!token || !movie) return;
    setMessage("");
    const wasInWatchlist = movie.in_watchlist;
    setMovie({ ...movie, in_watchlist: !wasInWatchlist });
    const res = wasInWatchlist
      ? await fetch(`http://localhost:8000/watchlist/${tmdbId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch("http://localhost:8000/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tmdb_id: Number(tmdbId) }),
        });
    if (!res.ok) {
      setMessage("Failed to update watchlist.");
      setMovie((prev) => (prev ? { ...prev, in_watchlist: wasInWatchlist } : prev));
    }
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
              <div className="flex flex-wrap items-center gap-5">
                <StarRating value={movie.your_rating} onRate={handleRate} onClear={handleClearRating} />

                <TrackButton
                  icon="eye"
                  active={movie.watched}
                  inactiveLabel="Watch"
                  activeLabel="Watched"
                  onClick={toggleWatched}
                />

                <TrackButton
                  icon="bookmark"
                  active={movie.in_watchlist}
                  inactiveLabel="Watchlist"
                  activeLabel="In Watchlist"
                  onClick={toggleWatchlist}
                />

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
