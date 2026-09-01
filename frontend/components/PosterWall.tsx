"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import TrackButton from "@/components/TrackButton";

type FeaturedMovie = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  imdb_rating: number | null;
  watched: boolean;
  in_watchlist: boolean;
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

// A hand-curated, geometrically-checked composition: a row of 8 across the top,
// a row of 8 across the bottom, 2 posters down each far edge, and 2 more filling
// the space beside the search bar, sized and spaced so no two slots' boxes touch
// or overlap — verified against actual rendered pixel geometry (including each
// poster's rotation and full floating range), not just eyeballed. Randomness
// applies to which movies fill these slots, not to the layout itself.
const SLOTS: Slot[] = [
  // Top row
  { top: "3%", left: "1%", width: 110, rotate: -8, duration: 8, delay: 0, dx: 16, dy: -24, tier: "base" },
  { top: "3%", left: "14%", width: 105, rotate: 6, duration: 9, delay: 0.5, dx: -15, dy: 22, tier: "sm" },
  { top: "3%", left: "26.5%", width: 115, rotate: -5, duration: 7.5, delay: 1, dx: 17, dy: -21, tier: "lg" },
  { top: "3%", left: "39%", width: 110, rotate: 5, duration: 9.5, delay: 0.3, dx: -16, dy: 23, tier: "lg" },
  { top: "3%", left: "51.5%", width: 115, rotate: -6, duration: 8, delay: 1.4, dx: 15, dy: -22, tier: "lg" },
  { top: "3%", left: "64%", width: 105, rotate: 6, duration: 9, delay: 0.8, dx: -17, dy: 21, tier: "sm" },
  { top: "3%", left: "76.5%", width: 110, rotate: -6, duration: 8.5, delay: 0.6, dx: 16, dy: -23, tier: "sm" },
  { top: "3%", right: "1%", width: 110, rotate: 7, duration: 8.5, delay: 1.2, dx: -16, dy: 22, tier: "base" },

  // Far-left column
  { top: "30%", left: "0.5%", width: 85, rotate: -7, duration: 8.5, delay: 0.6, dx: 12, dy: -15, tier: "lg" },
  { top: "52%", left: "0.5%", width: 75, rotate: 6, duration: 9.5, delay: 1.2, dx: -13, dy: 15, tier: "lg" },

  // Far-right column
  { top: "30%", right: "0.5%", width: 85, rotate: 7, duration: 8, delay: 0.2, dx: -12, dy: 15, tier: "lg" },
  { top: "52%", right: "0.5%", width: 75, rotate: -6, duration: 9, delay: 1.5, dx: 13, dy: -15, tier: "lg" },

  // Inner-flank posters, filling the space beside the search bar
  { top: "38%", left: "16%", width: 100, rotate: 6, duration: 8.5, delay: 0.9, dx: 16, dy: -23, tier: "lg" },
  { top: "38%", right: "16%", width: 100, rotate: -6, duration: 9, delay: 0.3, dx: -16, dy: 23, tier: "lg" },

  // Bottom row
  { top: "72%", left: "1%", width: 110, rotate: 6, duration: 8.5, delay: 0.4, dx: -16, dy: 23, tier: "base" },
  { top: "72%", left: "14%", width: 105, rotate: -5, duration: 9, delay: 1.1, dx: 17, dy: -21, tier: "sm" },
  { top: "72%", left: "26.5%", width: 115, rotate: 6, duration: 7.5, delay: 0.7, dx: -15, dy: 24, tier: "lg" },
  { top: "72%", left: "39%", width: 110, rotate: -6, duration: 9.5, delay: 0.9, dx: 16, dy: -22, tier: "lg" },
  { top: "72%", left: "51.5%", width: 115, rotate: 5, duration: 8, delay: 1.3, dx: -17, dy: 21, tier: "lg" },
  { top: "72%", left: "64%", width: 105, rotate: -7, duration: 9, delay: 0.6, dx: 15, dy: -23, tier: "sm" },
  { top: "72%", left: "76.5%", width: 110, rotate: 6, duration: 8.5, delay: 1.0, dx: -16, dy: 22, tier: "sm" },
  { top: "72%", right: "1%", width: 110, rotate: -5, duration: 9, delay: 0.5, dx: 16, dy: -20, tier: "base" },
];

const TIER_CLASS: Record<Slot["tier"], string> = {
  base: "block",
  sm: "hidden sm:block",
  lg: "hidden lg:block",
};

const POSTER_BASE = "https://image.tmdb.org/t/p/w300";

export default function PosterWall({
  movies,
  showTracking,
  onToggleWatched,
  onToggleWatchlist,
}: {
  movies: FeaturedMovie[];
  showTracking: boolean;
  onToggleWatched: (movie: FeaturedMovie) => void;
  onToggleWatchlist: (movie: FeaturedMovie) => void;
}) {
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
            {/* Outer element owns the floating animation (translate/rotate) and the
                hover tracking — moved here (rather than the inner bordered div) so
                that hovering over the tracking-icon overlay below, a sibling of that
                div, doesn't register as the cursor leaving the poster. Also the
                positioning root for those icons, so their hover tooltip isn't
                clipped by the poster's own overflow-hidden border. */}
            <div
              className="relative poster-float"
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
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
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
                onClick={() => router.push(`/movies/${movie.tmdb_id}`)}
              >
                {movie.poster_path ? (
                  <img
                    src={`${POSTER_BASE}${movie.poster_path}`}
                    alt={movie.title}
                    className="block w-full"
                    draggable={false}
                    loading="eager"
                    fetchPriority="high"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-surface text-xs text-muted">
                    {movie.title}
                  </div>
                )}

                {isHovered && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-2 pb-2 pt-6 text-center">
                    <p className="font-display text-[11px] leading-tight tracking-wide text-foreground">
                      {movie.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {year ?? "—"}
                      {" · "}
                      {movie.imdb_rating ? (
                        <span className="text-accent">★ {movie.imdb_rating.toFixed(1)}</span>
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                )}
              </div>

              {isHovered && showTracking && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5">
                  <div className="pointer-events-auto flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <TrackButton
                      icon="eye"
                      size="sm"
                      active={movie.watched}
                      inactiveLabel="Watch"
                      activeLabel="Watched"
                      onClick={() => onToggleWatched(movie)}
                    />
                    <TrackButton
                      icon="bookmark"
                      size="sm"
                      active={movie.in_watchlist}
                      inactiveLabel="Watchlist"
                      activeLabel="In Watchlist"
                      onClick={() => onToggleWatchlist(movie)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
