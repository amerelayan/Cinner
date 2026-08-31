"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/supabaseClient";
import FavoritesPicker from "@/components/FavoritesPicker";

type Favorite = { tmdb_id: number; title: string; poster_path: string | null };
type SearchResult = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};
type Profile = {
  username: string;
  profile_picture_url: string | null;
  preferred_genres: string[] | null;
  preferred_movie_age: string | null;
  prefers_imdb_top_250: boolean | null;
};

const AGE_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "New movies" },
  { value: "last_5_years", label: "Last 5 years" },
  { value: "last_10_years", label: "Last 10 years" },
  { value: "last_20_years", label: "Last 20 years" },
  { value: "25_plus_years", label: "25+ years" },
  { value: "no_preference", label: "No preference" },
];

const CHIP =
  "rounded-full border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-accent hover:text-accent";
const CHIP_ACTIVE =
  "rounded-full border border-accent bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/20";
const PRIMARY_BUTTON =
  "rounded bg-accent px-6 py-2.5 font-display text-sm tracking-[0.05em] text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent";

const STEP_TITLES: Record<number, string> = {
  1: "Pick 5 favorite movies",
  2: "What do you enjoy?",
  3: "Which eras do you prefer?",
  4: "One last thing",
};

export default function OnboardingPage() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  const [ageChoice, setAgeChoice] = useState("");

  useEffect(() => {
    async function init() {
      const t = await getAccessToken();
      if (!t) {
        router.push("/login");
        return;
      }
      setToken(t);

      const [favRes, profRes, genresRes] = await Promise.all([
        fetch("http://localhost:8000/favorites", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("http://localhost:8000/profile", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("http://localhost:8000/genres"),
      ]);

      const favData = await favRes.json();
      const profData: Profile = await profRes.json();
      const genresData = await genresRes.json();

      setFavorites(favData.favorites);
      setAllGenres(genresData.genres);

      if (favData.favorites.length < 5) {
        setStep(1);
      } else if (profData.preferred_genres === null) {
        setStep(2);
      } else if (profData.preferred_movie_age === null) {
        setStep(3);
      } else if (profData.prefers_imdb_top_250 === null) {
        setStep(4);
      } else {
        router.push("/profile");
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadFavorites(t: string) {
    const res = await fetch("http://localhost:8000/favorites", {
      headers: { Authorization: `Bearer ${t}` },
    });
    const data = await res.json();
    setFavorites(data.favorites);
  }

  useEffect(() => {
    if (step !== 1) return;
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
  }, [query, step]);

  async function handleRemoveFavorite(tmdbId: number) {
    if (!token) return;
    await fetch(`http://localhost:8000/favorites/${tmdbId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await reloadFavorites(token);
  }

  async function handleAddFavorite(tmdbId: number) {
    if (!token) return;
    setError("");
    const res = await fetch("http://localhost:8000/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tmdb_id: tmdbId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? "Failed to add favorite.");
      return;
    }
    await reloadFavorites(token);
  }

  function toggleGenre(genre: string) {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  }

  async function handleSubmitGenres() {
    if (!token || selectedGenres.length === 0) return;
    setError("");
    const res = await fetch("http://localhost:8000/profile/genres", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ genres: selectedGenres }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? "Failed to save genres.");
      return;
    }
    setStep(3);
  }

  async function handleSubmitAge() {
    if (!token || !ageChoice) return;
    setError("");
    const res = await fetch("http://localhost:8000/profile/age-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ age_preference: ageChoice }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? "Failed to save preference.");
      return;
    }
    setStep(4);
  }

  async function handleSubmitImdbPreference(value: boolean) {
    if (!token) return;
    setError("");
    const res = await fetch("http://localhost:8000/profile/imdb-top-250-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prefers_imdb_top_250: value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? "Failed to save preference.");
      return;
    }
    router.push("/profile");
  }

  if (step === null) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-muted">Loading...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 sm:px-6">
      <div className="rounded border border-border bg-surface p-6 sm:p-10">
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <span
              key={s}
              className={`h-1.5 w-8 rounded-full transition-colors ${
                s <= step ? "bg-accent" : "bg-border"
              }`}
            />
          ))}
        </div>

        <h1 className="mt-6 text-center font-display text-2xl text-foreground sm:text-3xl">
          {STEP_TITLES[step]}
        </h1>

        {error && <p className="mt-4 text-center text-sm text-accent">{error}</p>}

        {step === 1 && (
          <section className="mt-8">
            <p className="mb-4 text-center text-sm text-muted">{favorites.length}/5 selected</p>
            <FavoritesPicker
              favorites={favorites}
              query={query}
              onQueryChange={setQuery}
              results={results}
              onAdd={handleAddFavorite}
              onRemove={handleRemoveFavorite}
            />
            <div className="mt-8 flex justify-center">
              <button
                disabled={favorites.length !== 5}
                onClick={() => setStep(2)}
                className={PRIMARY_BUTTON}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="mt-8">
            <p className="mb-5 text-center text-sm text-muted">Select at least one genre.</p>
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
            <div className="mt-8 flex justify-center">
              <button
                disabled={selectedGenres.length === 0}
                onClick={handleSubmitGenres}
                className={PRIMARY_BUTTON}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="mt-8">
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
            <div className="mt-8 flex justify-center">
              <button disabled={!ageChoice} onClick={handleSubmitAge} className={PRIMARY_BUTTON}>
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="mt-8">
            <p className="mb-6 text-center text-sm text-muted">
              Do you enjoy critically acclaimed classics (IMDb&apos;s Top 250)?
            </p>
            <div className="flex justify-center gap-4">
              <button onClick={() => handleSubmitImdbPreference(true)} className={CHIP}>
                Yes
              </button>
              <button onClick={() => handleSubmitImdbPreference(false)} className={CHIP}>
                No
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
