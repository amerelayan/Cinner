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
  left?: string;
  right?: string;
  rotate: number;
  width: number;
  duration: number;
  delay: number;
  dx: number;
  dy: number;
  tier: "base" | "sm" | "lg";
};

// A hand-curated, geometrically-checked composition: a row of 6 across the top,
// a row of 5 across the bottom, and 2 posters down each side, sized and spaced so
// no two slots' boxes touch or overlap (verified against actual pixel geometry,
// including margin for each poster's rotation) at the reference layout width.
// Randomness applies to which movies fill these slots, not to the layout itself.
const SLOTS: Slot[] = [
  // Top row
  { top: "3%", left: "3%", width: 72, rotate: -8, duration: 8, delay: 0, dx: 10, dy: -16, tier: "base" },
  { top: "3%", left: "19%", width: 100, rotate: 6, duration: 9, delay: 0.5, dx: -9, dy: 15, tier: "sm" },
  { top: "3%", left: "35%", width: 100, rotate: -5, duration: 7.5, delay: 1, dx: 11, dy: -14, tier: "lg" },
  { top: "3%", left: "53%", width: 100, rotate: 5, duration: 9.5, delay: 0.3, dx: -10, dy: 16, tier: "lg" },
  { top: "3%", left: "69%", width: 100, rotate: -6, duration: 8, delay: 1.4, dx: 10, dy: -15, tier: "sm" },
  { top: "3%", right: "3%", width: 72, rotate: 7, duration: 9, delay: 0.8, dx: -11, dy: 14, tier: "base" },

  // Left column
  { top: "28%", left: "1%", width: 80, rotate: -7, duration: 8.5, delay: 0.6, dx: 9, dy: -15, tier: "lg" },
  { top: "48%", left: "1%", width: 80, rotate: 6, duration: 9.5, delay: 1.2, dx: -10, dy: 14, tier: "lg" },

  // Right column
  { top: "28%", right: "1%", width: 80, rotate: 7, duration: 8, delay: 0.2, dx: -9, dy: 15, tier: "lg" },
  { top: "48%", right: "1%", width: 80, rotate: -6, duration: 9, delay: 1.5, dx: 10, dy: -14, tier: "lg" },

  // Bottom row
  { top: "68%", left: "3%", width: 72, rotate: 6, duration: 8.5, delay: 0.4, dx: -10, dy: 15, tier: "base" },
  { top: "68%", left: "22%", width: 95, rotate: -5, duration: 9, delay: 1.1, dx: 11, dy: -14, tier: "sm" },
  { top: "68%", left: "42%", width: 100, rotate: 6, duration: 7.5, delay: 0.7, dx: -9, dy: 16, tier: "lg" },
  { top: "68%", left: "62%", width: 95, rotate: -6, duration: 9.5, delay: 0.9, dx: 10, dy: -15, tier: "sm" },
  { top: "68%", right: "3%", width: 72, rotate: 5, duration: 8, delay: 1.3, dx: -11, dy: 14, tier: "base" },
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
              right: slot.right,
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
                  // Negative delay starts the animation immediately, offset partway
                  // into its cycle, instead of waiting to start — a positive delay
                  // combined with an inline animation-play-state can otherwise leave
                  // the animation stuck indefinitely before it ever begins.
                  animationDelay: `-${slot.delay}s`,
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
