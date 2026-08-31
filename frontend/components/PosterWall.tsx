"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type FeaturedMovie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  tmdb_rating: number | null;
};

type Slot = {
  top: string;
  left: string;
  rotate: number;
  width: number;
  duration: number;
  delay: number;
  dx: number;
  dy: number;
  tier: "base" | "sm" | "lg";
};

// A hand-curated composition of poster positions around the central search area.
// Randomness applies to which movies fill these slots, not to the layout itself,
// so the homepage keeps a consistent, deliberate arrangement on every load.
const SLOTS: Slot[] = [
  { top: "8%", left: "5%", rotate: -9, width: 150, duration: 9, delay: 0, dx: 5, dy: -10, tier: "lg" },
  { top: "14%", left: "20%", rotate: 6, width: 130, duration: 10.5, delay: 0.6, dx: -6, dy: 8, tier: "sm" },
  { top: "5%", left: "40%", rotate: -4, width: 140, duration: 8.5, delay: 1.2, dx: 6, dy: -9, tier: "lg" },
  { top: "9%", left: "60%", rotate: 5, width: 145, duration: 11, delay: 0.3, dx: -5, dy: 9, tier: "lg" },
  { top: "7%", left: "80%", rotate: -7, width: 150, duration: 9.5, delay: 1.6, dx: 6, dy: -8, tier: "lg" },
  { top: "16%", left: "4%", rotate: 8, width: 115, duration: 10, delay: 0.9, dx: -5, dy: 7, tier: "base" },
  { top: "22%", left: "90%", rotate: -6, width: 120, duration: 9, delay: 1.9, dx: 5, dy: -7, tier: "base" },
  { top: "34%", left: "2%", rotate: -5, width: 140, duration: 11.5, delay: 0.4, dx: -6, dy: 9, tier: "sm" },
  { top: "36%", left: "93%", rotate: 6, width: 135, duration: 10, delay: 1.1, dx: 6, dy: -9, tier: "sm" },
  { top: "58%", left: "3%", rotate: 7, width: 130, duration: 9.5, delay: 0.7, dx: -5, dy: 8, tier: "base" },
  { top: "60%", left: "92%", rotate: -8, width: 130, duration: 10.5, delay: 1.4, dx: 6, dy: -8, tier: "base" },
  { top: "78%", left: "8%", rotate: 5, width: 150, duration: 9, delay: 0.2, dx: -6, dy: -9, tier: "lg" },
  { top: "80%", left: "28%", rotate: -6, width: 120, duration: 11, delay: 1.7, dx: 5, dy: 8, tier: "sm" },
  { top: "76%", left: "68%", rotate: 6, width: 125, duration: 10, delay: 0.5, dx: -5, dy: -8, tier: "sm" },
  { top: "79%", left: "87%", rotate: -5, width: 145, duration: 9.5, delay: 1.0, dx: 6, dy: 9, tier: "lg" },
];

const TIER_CLASS: Record<Slot["tier"], string> = {
  base: "block",
  sm: "hidden sm:block",
  lg: "hidden lg:block",
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w300";

export default function PosterWall({ movies }: { movies: FeaturedMovie[] }) {
  const router = useRouter();
  const [hovered, setHovered] = useState<number | null>(null);

  const count = Math.min(movies.length, SLOTS.length);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {SLOTS.slice(0, count).map((slot, i) => {
        const movie = movies[i];
        const isHovered = hovered === i;
        const year = movie.release_date ? movie.release_date.slice(0, 4) : null;

        return (
          <div
            key={movie.tmdb_id}
            className={`pointer-events-auto absolute ${TIER_CLASS[slot.tier]}`}
            style={{
              top: slot.top,
              left: slot.left,
              width: slot.width,
              zIndex: isHovered ? 30 : 1,
            }}
          >
            {/* Outer element owns the floating animation (translate/rotate). */}
            <div
              className="poster-float"
              style={
                {
                  "--r": `${slot.rotate}deg`,
                  "--dx": `${slot.dx}px`,
                  "--dy": `${slot.dy}px`,
                  animationDuration: `${slot.duration}s`,
                  animationDelay: `${slot.delay}s`,
                  animationPlayState: isHovered ? "paused" : "running",
                } as React.CSSProperties
              }
            >
              {/* Inner element owns the hover scale, since a CSS animation and an
                  inline transform can't both target `transform` on the same element. */}
              <div
                className="relative cursor-pointer overflow-hidden rounded-sm border shadow-lg transition-transform duration-300"
                style={{
                  transform: isHovered ? "scale(1.08)" : "scale(1)",
                  filter: isHovered ? "brightness(1.1)" : "brightness(0.8) saturate(0.85)",
                  borderColor: isHovered ? "var(--accent)" : "var(--border)",
                  boxShadow: isHovered
                    ? "0 0 24px rgba(161, 29, 36, 0.45), 0 8px 24px rgba(0,0,0,0.5)"
                    : "0 8px 20px rgba(0,0,0,0.5)",
                  transition: "filter 300ms, border-color 300ms, box-shadow 300ms, transform 300ms",
                }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => router.push(`/movies/${movie.tmdb_id}`)}
              >
                {movie.poster_path ? (
                  <img
                    src={`${POSTER_BASE}${movie.poster_path}`}
                    alt={movie.title}
                    className="block w-full"
                    draggable={false}
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-surface text-xs text-muted">
                    {movie.title}
                  </div>
                )}

                {isHovered && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-2 pb-2 pt-6 text-center">
                    <p className="font-display text-xs tracking-wide text-foreground">
                      {movie.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {year ?? "—"}
                      {" · "}
                      {movie.tmdb_rating ? (
                        <span className="text-accent">★ {movie.tmdb_rating.toFixed(1)}</span>
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
