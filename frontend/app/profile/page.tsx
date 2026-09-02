"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabaseClient";
import LoadingSpinner from "@/components/LoadingSpinner";
import { API_BASE_URL } from "@/lib/api";

type Favorite = { tmdb_id: number; title: string; poster_path: string | null };

type Profile = {
  username: string;
  profile_picture_url: string | null;
  location: string | null;
  watched_count: number;
  watchlist_count: number;
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w200";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const [pictureInput, setPictureInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);

  async function load() {
    const currentToken = await getAccessToken();
    if (!currentToken) {
      setError("Please log in to view your profile.");
      return;
    }
    setToken(currentToken);

    const [favRes, profRes] = await Promise.all([
      fetch(`${API_BASE_URL}/favorites`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      }),
      fetch(`${API_BASE_URL}/profile`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      }),
    ]);

    if (!favRes.ok || !profRes.ok) {
      setError("Failed to load profile.");
      return;
    }

    const favData = await favRes.json();
    const profData: Profile = await profRes.json();
    setFavorites(favData.favorites);
    setProfile(profData);
    setLocationInput(profData.location ?? "");
    setPictureInput(profData.profile_picture_url ?? "");
    setPictureFailed(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSaveDetails() {
    if (!token) return;
    setSaving(true);
    await Promise.all([
      fetch(`${API_BASE_URL}/profile/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ location: locationInput }),
      }),
      fetch(`${API_BASE_URL}/profile/picture`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profile_picture_url: pictureInput }),
      }),
    ]);
    setSaving(false);
    setEditing(false);
    await load();
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-muted">{error}</p>
      </main>
    );
  }

  if (!profile || !favorites) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  const initial = profile.username.charAt(0).toUpperCase();
  const showPicture = profile.profile_picture_url && !pictureFailed;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      {/* Profile card */}
      <div className="rounded border border-border bg-surface p-6 sm:p-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {showPicture ? (
            <img
              src={profile.profile_picture_url!}
              alt={profile.username}
              onError={() => setPictureFailed(true)}
              className="h-24 w-24 flex-shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-display text-3xl text-accent">
              {initial}
            </div>
          )}

          <div className="flex-1 text-center sm:text-left">
            <h1 className="font-display text-2xl text-foreground sm:text-3xl">
              {profile.username}
            </h1>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-muted sm:justify-start">
              <span>{profile.location ?? "Location not set"}</span>
              <Link
                href="/profile/watched"
                className="transition-colors hover:text-accent"
              >
                <span className="text-foreground">{profile.watched_count}</span> films watched
              </Link>
              <Link
                href="/profile/watchlist"
                className="transition-colors hover:text-accent"
              >
                <span className="text-foreground">{profile.watchlist_count}</span> in watchlist
              </Link>
            </div>

            {editing ? (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-muted">
                    Location
                  </label>
                  <input
                    type="text"
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    placeholder="e.g. Jerusalem, Israel"
                    className="w-full max-w-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-muted">
                    Profile picture URL
                  </label>
                  <input
                    type="text"
                    value={pictureInput}
                    onChange={(e) => setPictureInput(e.target.value)}
                    placeholder="https://..."
                    className="w-full max-w-xs"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveDetails}
                    disabled={saving}
                    className="rounded bg-accent px-4 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:border-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="relative mt-3 text-sm text-muted transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-0 after:bg-accent after:transition-all after:duration-300 hover:after:w-full"
              >
                Edit profile
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Favorites card */}
      <div className="mt-6 rounded border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-foreground">My 5 Favorites</h2>
          <Link
            href="/profile/favorites/edit"
            className="relative text-sm text-muted transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-0 after:bg-accent after:transition-all after:duration-300 hover:after:w-full"
          >
            Edit Favorites
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-5">
          {favorites.map((f) => (
            <Link key={f.tmdb_id} href={`/movies/${f.tmdb_id}`} className="group">
              {f.poster_path ? (
                <img
                  src={`${POSTER_BASE}${f.poster_path}`}
                  alt={f.title}
                  className="w-full rounded-sm border border-border shadow transition-transform duration-200 group-hover:-translate-y-1"
                />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center rounded-sm border border-border bg-surface-2 text-xs text-muted">
                  {f.title}
                </div>
              )}
              <p className="mt-2 truncate text-xs text-foreground">{f.title}</p>
            </Link>
          ))}
          {Array.from({ length: Math.max(0, 5 - favorites.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex aspect-[2/3] w-full items-center justify-center rounded-sm border border-dashed border-border text-xs text-muted"
            >
              Empty
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
