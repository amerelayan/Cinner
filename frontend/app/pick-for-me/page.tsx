"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import RatingBadge from "@/components/RatingBadge";
import TrackButton from "@/components/TrackButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import { API_BASE_URL } from "@/lib/api";

type Movie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  synopsis: string | null;
  director: string | null;
  genres: string[] | null;
  main_cast: string[] | null;
  runtime_minutes: number | null;
  imdb_rating: number | null;
  rotten_tomatoes_rating: number | null;
  match_pct: number | null;
  predicted_rating: number | null;
};

type Answers = {
  genres: string[];
  agePreference: string;
  prefersImdbTop250: boolean;
  mood: string;
  timeAvailable: string;
};

const AGE_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "New movies" },
  { value: "last_5_years", label: "Last 5 years" },
  { value: "last_10_years", label: "Last 10 years" },
  { value: "last_20_years", label: "Last 20 years" },
  { value: "25_plus_years", label: "25+ years" },
  { value: "no_preference", label: "No preference" },
];

const MOOD_OPTIONS: { value: string; label: string }[] = [
  { value: "happy", label: "Happy — keep it going" },
  { value: "sad", label: "Down — cheer me up" },
  { value: "stressed", label: "Stressed — something easy" },
  { value: "excited", label: "Excited — give me a rush" },
  { value: "neutral", label: "No particular mood" },
];

const TIME_OPTIONS: { value: string; label: string }[] = [
  { value: "short", label: "Under 100 min" },
  { value: "long", label: "Have all night" },
  { value: "doesnt_matter", label: "Doesn't matter" },
];

const CHIP =
  "rounded-full border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-accent hover:text-accent";
const CHIP_ACTIVE =
  "rounded-full border border-accent bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/20";
const PRIMARY_BUTTON =
  "rounded-full bg-accent px-8 py-3 font-display text-sm tracking-[0.05em] text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0";

const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

type View = "quiz" | "loading" | "reveal" | "empty";

export default function PickForMePage() {
  const [token, setToken] = useState<string | null>(null);
  const [allGenres, setAllGenres] = useState<string[]>([]);

  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [ageChoice, setAgeChoice] = useState("");
  const [imdbTop250, setImdbTop250] = useState<boolean | null>(null);
  const [moodChoice, setMoodChoice] = useState("");
  const [timeChoice, setTimeChoice] = useState("");

  const [view, setView] = useState<View>("quiz");
  const [error, setError] = useState("");
  const [movies, setMovies] = useState<Movie[]>([]);
  const [index, setIndex] = useState(0);
  const [revealKey, setRevealKey] = useState(0);
  const [answers, setAnswers] = useState<Answers | null>(null);

  useEffect(() => {
    async function init() {
      setToken(await getAccessToken());
      const res = await fetch(`${API_BASE_URL}/genres`);
      if (res.ok) {
        const data = await res.json();
        setAllGenres(data.genres ?? []);
      }
    }
    init();
  }, []);

  function toggleGenre(genre: string) {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  }

  async function fetchBatch(a: Answers): Promise<Movie[]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE_URL}/pick-for-me`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        genres: a.genres,
        age_preference: a.agePreference,
        prefers_imdb_top_250: a.prefersImdbTop250,
        mood: a.mood,
        time_available: a.timeAvailable,
      }),
    });
    if (!res.ok) throw new Error("request failed");
    const data = await res.json();
    return data.movies ?? [];
  }

  async function handleSubmitQuiz() {
    if (
      selectedGenres.length === 0 ||
      !ageChoice ||
      imdbTop250 === null ||
      !moodChoice ||
      !timeChoice
    )
      return;
    setError("");
    setView("loading");
    const a: Answers = {
      genres: selectedGenres,
      agePreference: ageChoice,
      prefersImdbTop250: imdbTop250,
      mood: moodChoice,
      timeAvailable: timeChoice,
    };
    setAnswers(a);
    try {
      const batch = await fetchBatch(a);
      setMovies(batch);
      setIndex(0);
      setRevealKey((k) => k + 1);
      setView(batch.length > 0 ? "reveal" : "empty");
    } catch {
      setError("Couldn't find a pick right now — try again.");
      setView("quiz");
    }
  }

  async function handleRegenerate() {
    if (!answers) return;
    if (index + 1 < movies.length) {
      setIndex((i) => i + 1);
      setRevealKey((k) => k + 1);
      return;
    }
    setView("loading");
    try {
      const batch = await fetchBatch(answers);
      setMovies(batch);
      setIndex(0);
      setRevealKey((k) => k + 1);
      setView(batch.length > 0 ? "reveal" : "empty");
    } catch {
      setError("Couldn't find another pick right now — try again.");
      setView("reveal");
    }
  }

  function handleChangeAnswers() {
    setView("quiz");
    setMovies([]);
    setAnswers(null);
    setError("");
  }

  const current = movies[index];
  const [tracked, setTracked] = useState<{ watched: boolean; in_watchlist: boolean }>({
    watched: false,
    in_watchlist: false,
  });

  useEffect(() => {
    setTracked({ watched: false, in_watchlist: false });
  }, [index, movies]);

  async function toggleWatched() {
    if (!token || !current) return;
    const was = tracked.watched;
    setTracked((t) => ({ ...t, watched: !was }));
    const res = was
      ? await fetch(`${API_BASE_URL}/watched/${current.tmdb_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch(`${API_BASE_URL}/watched`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tmdb_id: current.tmdb_id }),
        });
    if (!res.ok) setTracked((t) => ({ ...t, watched: was }));
  }

  async function toggleWatchlist() {
    if (!token || !current) return;
    const was = tracked.in_watchlist;
    setTracked((t) => ({ ...t, in_watchlist: !was }));
    const res = was
      ? await fetch(`${API_BASE_URL}/watchlist/${current.tmdb_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      : await fetch(`${API_BASE_URL}/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tmdb_id: current.tmdb_id }),
        });
    if (!res.ok) setTracked((t) => ({ ...t, in_watchlist: was }));
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-14 sm:px-6">
      <div className="text-center">
        <p className="font-display text-3xl tracking-wide text-foreground sm:text-4xl">
          Pick a Movie for Me
        </p>
        <p className="mt-3 text-sm text-muted">
          Answer a few quick questions and we&apos;ll find something worth watching.
        </p>
      </div>

      {error && <p className="mt-6 text-center text-sm text-accent">{error}</p>}

      {view === "quiz" && (
        <div className="mt-10 rounded border border-border bg-surface p-6 sm:p-10">
          <div>
            <p className="mb-4 text-center text-sm text-muted">
              What are you in the mood for? (pick one or more)
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {allGenres.map((genre) => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={selectedGenres.includes(genre) ? CHIP_ACTIVE : CHIP}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <p className="mb-4 text-center text-sm text-muted">How old should it be?</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {AGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setAgeChoice(opt.value)}
                  className={ageChoice === opt.value ? CHIP_ACTIVE : CHIP}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <p className="mb-4 text-center text-sm text-muted">How are you feeling today?</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {MOOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setMoodChoice(opt.value)}
                  className={moodChoice === opt.value ? CHIP_ACTIVE : CHIP}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <p className="mb-4 text-center text-sm text-muted">How much time do you have?</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {TIME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTimeChoice(opt.value)}
                  className={timeChoice === opt.value ? CHIP_ACTIVE : CHIP}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <p className="mb-4 text-center text-sm text-muted">
              Do you want a critically acclaimed pick (IMDb&apos;s Top 250 tier), or are you open to anything decent?
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setImdbTop250(true)}
                className={imdbTop250 === true ? CHIP_ACTIVE : CHIP}
              >
                Acclaimed only
              </button>
              <button
                onClick={() => setImdbTop250(false)}
                className={imdbTop250 === false ? CHIP_ACTIVE : CHIP}
              >
                Anything decent
              </button>
            </div>
          </div>

          <div className="mt-12 flex justify-center">
            <button
              disabled={
                selectedGenres.length === 0 ||
                !ageChoice ||
                imdbTop250 === null ||
                !moodChoice ||
                !timeChoice
              }
              onClick={handleSubmitQuiz}
              className={PRIMARY_BUTTON}
            >
              Find My Movie
            </button>
          </div>
        </div>
      )}

      {view === "loading" && (
        <div className="mt-16">
          <LoadingSpinner size="lg" label="Searching for your movie..." />
        </div>
      )}

      {view === "empty" && (
        <div className="mt-16 text-center">
          <p className="text-sm text-muted">
            Couldn&apos;t find anything matching those preferences — try loosening them a bit.
          </p>
          <button onClick={handleChangeAnswers} className={`${PRIMARY_BUTTON} mt-6`}>
            Try Different Preferences
          </button>
        </div>
      )}

      {view === "reveal" && current && (
        <div key={revealKey} className="pick-reveal mt-10">
          <div className="overflow-hidden rounded border border-border bg-surface shadow-2xl">
            <div className="flex flex-col sm:flex-row">
              <Link
                href={`/movies/${current.tmdb_id}`}
                className="block shrink-0 sm:w-64"
              >
                {current.poster_path ? (
                  <img
                    src={`${POSTER_BASE}${current.poster_path}`}
                    alt={current.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-surface-2 text-sm text-muted">
                    {current.title}
                  </div>
                )}
              </Link>

              <div className="flex flex-1 flex-col p-6 sm:p-8">
                <Link
                  href={`/movies/${current.tmdb_id}`}
                  className="font-display text-2xl text-foreground hover:text-accent"
                >
                  {current.title}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  {[
                    current.release_date ? current.release_date.slice(0, 4) : null,
                    current.genres && current.genres.length > 0 ? current.genres.join(", ") : null,
                    current.runtime_minutes ? `${current.runtime_minutes} min` : null,
                  ]
                    .filter(Boolean)
                    .join("  ·  ")}
                </p>

                <div className="mt-4 flex flex-wrap gap-2.5">
                  <RatingBadge source="imdb" value={current.imdb_rating} suffix="/10" />
                  <RatingBadge source="rt" value={current.rotten_tomatoes_rating} suffix="%" />
                </div>

                {current.match_pct !== null && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <div className="rounded-lg border border-border bg-surface-2 px-4 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted">Match</p>
                      <p className="font-display text-xl text-accent">{current.match_pct}%</p>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-2 px-4 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted">Predicted Rating</p>
                      <p className="font-display text-xl text-foreground">
                        {current.predicted_rating}
                        <span className="text-sm text-muted">/10</span>
                      </p>
                    </div>
                  </div>
                )}

                {current.synopsis && (
                  <p className="mt-4 text-sm leading-relaxed text-muted">{current.synopsis}</p>
                )}

                {current.director && (
                  <p className="mt-4 text-sm text-muted">
                    <span className="text-foreground">Director</span> {current.director}
                  </p>
                )}
                {current.main_cast && current.main_cast.length > 0 && (
                  <p className="mt-1 text-sm text-muted">
                    <span className="text-foreground">Cast</span> {current.main_cast.slice(0, 4).join(", ")}
                  </p>
                )}

                {token && (
                  <div className="mt-5 flex gap-2.5">
                    <TrackButton
                      icon="eye"
                      size="sm"
                      active={tracked.watched}
                      inactiveLabel="Watch"
                      activeLabel="Watched"
                      onClick={toggleWatched}
                    />
                    <TrackButton
                      icon="bookmark"
                      size="sm"
                      active={tracked.in_watchlist}
                      inactiveLabel="Watchlist"
                      activeLabel="In Watchlist"
                      onClick={toggleWatchlist}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button onClick={handleRegenerate} className={PRIMARY_BUTTON}>
              Regenerate
            </button>
            <button
              onClick={handleChangeAnswers}
              className="text-sm text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              Change my answers
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
