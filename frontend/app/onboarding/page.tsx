"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/supabaseClient";

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

  const isFavorite = (tmdbId: number) => favorites.some((f) => f.tmdb_id === tmdbId);

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
      <main style={{ padding: 24 }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 480 }}>
      <h1>Welcome to Cinner</h1>
      {error && <p>{error}</p>}

      {step === 1 && (
        <section>
          <h2>Step 1: Choose your 5 favorite movies</h2>
          <p>{favorites.length}/5</p>

          <h3>Current Favorites</h3>
          {favorites.length === 0 && <p>No favorites yet.</p>}
          {favorites.map((f) => (
            <div key={f.tmdb_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>{f.title}</span>
              <button onClick={() => handleRemoveFavorite(f.tmdb_id)}>Remove</button>
            </div>
          ))}

          <h3>Search</h3>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a movie"
          />
          {results.map((r) => (
            <div key={r.tmdb_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>
                {r.title} {r.release_date ? `(${r.release_date.slice(0, 4)})` : ""}
              </span>
              {isFavorite(r.tmdb_id) ? (
                <span>Already a favorite</span>
              ) : (
                <button onClick={() => handleAddFavorite(r.tmdb_id)}>Add</button>
              )}
            </div>
          ))}

          <p>
            <button disabled={favorites.length !== 5} onClick={() => setStep(2)}>
              Continue
            </button>
          </p>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>What movie genres do you enjoy?</h2>
          <p>Select at least one.</p>
          {allGenres.map((genre) => (
            <label key={genre} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={selectedGenres.includes(genre)}
                onChange={() => toggleGenre(genre)}
              />
              {genre}
            </label>
          ))}
          <p>
            <button disabled={selectedGenres.length === 0} onClick={handleSubmitGenres}>
              Continue
            </button>
          </p>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>What kind of movie eras do you prefer?</h2>
          {AGE_OPTIONS.map((opt) => (
            <label key={opt.value} style={{ display: "block" }}>
              <input
                type="radio"
                name="age-preference"
                value={opt.value}
                checked={ageChoice === opt.value}
                onChange={() => setAgeChoice(opt.value)}
              />
              {opt.label}
            </label>
          ))}
          <p>
            <button disabled={!ageChoice} onClick={handleSubmitAge}>
              Continue
            </button>
          </p>
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>Do you enjoy critically acclaimed classics (IMDb&apos;s Top 250)?</h2>
          <button onClick={() => handleSubmitImdbPreference(true)}>Yes</button>
          <button onClick={() => handleSubmitImdbPreference(false)}>No</button>
        </section>
      )}
    </main>
  );
}
