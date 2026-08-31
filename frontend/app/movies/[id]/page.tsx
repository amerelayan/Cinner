"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";

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

const POSTER_BASE = "https://image.tmdb.org/t/p/w300";
const RATING_OPTIONS = Array.from({ length: 19 }, (_, i) => 1 + i * 0.5);

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
      <main style={{ padding: 24 }}>
        <p>{error}</p>
      </main>
    );
  }

  if (!movie) {
    return (
      <main style={{ padding: 24 }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 600 }}>
      <div style={{ display: "flex", gap: 24 }}>
        {movie.poster_path ? (
          <img
            src={`${POSTER_BASE}${movie.poster_path}`}
            alt={movie.title}
            style={{ width: 200 }}
          />
        ) : (
          <div style={{ width: 200, height: 300, background: "#ccc" }} />
        )}
        <div>
          <h1>
            {movie.title}
            {movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ""}
          </h1>
          <p>IMDb: {movie.imdb_rating ?? "—"}</p>
          <p>Rotten Tomatoes: {movie.rotten_tomatoes_rating ?? "—"}</p>
          <p>Letterboxd: {movie.letterboxd_rating ?? "—"}</p>
          <p>
            Cinner rating: {movie.cinner_average_rating ?? "—"}
            {movie.cinner_ratings_count > 0 ? ` (${movie.cinner_ratings_count} ratings)` : ""}
          </p>
          <p>{movie.synopsis}</p>
          <p>Director: {movie.director ?? "—"}</p>
          <p>Cast: {movie.main_cast && movie.main_cast.length > 0 ? movie.main_cast.join(", ") : "—"}</p>
          <p>Genres: {movie.genres && movie.genres.length > 0 ? movie.genres.join(", ") : "—"}</p>
          <p>Language: {movie.language ?? "—"}</p>
          <p>Runtime: {movie.runtime_minutes ? `${movie.runtime_minutes} min` : "—"}</p>
        </div>
      </div>

      <hr />

      {token ? (
        <div>
          <h2>Your Actions</h2>

          <div>
            <label>Your rating: </label>
            <select value={ratingChoice} onChange={(e) => setRatingChoice(e.target.value)}>
              <option value="">-- select --</option>
              {RATING_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button onClick={handleRate} disabled={!ratingChoice}>
              Submit rating
            </button>
            {movie.your_rating !== null && (
              <button onClick={handleClearRating}>Clear rating</button>
            )}
          </div>

          <div>
            <button onClick={toggleWatched}>
              {movie.watched ? "Remove from Watched" : "Mark as Watched"}
            </button>
          </div>

          <div>
            <button onClick={toggleWatchlist}>
              {movie.in_watchlist ? "Remove from Watchlist" : "Add to Watchlist"}
            </button>
          </div>

          {message && <p>{message}</p>}
        </div>
      ) : (
        <p>
          <Link href="/login">Log in</Link> to rate, track, or add this movie to your watchlist.
        </p>
      )}
    </main>
  );
}
