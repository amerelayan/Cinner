"use client";

type Favorite = { tmdb_id: number; title: string; poster_path: string | null };
type SearchResult = {
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
};

const POSTER_THUMB = "https://image.tmdb.org/t/p/w92";
const POSTER_SLOT = "https://image.tmdb.org/t/p/w300";

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export default function FavoritesPicker({
  favorites,
  query,
  onQueryChange,
  results,
  onAdd,
  onRemove,
}: {
  favorites: Favorite[];
  query: string;
  onQueryChange: (query: string) => void;
  results: SearchResult[];
  onAdd: (movie: SearchResult) => void;
  onRemove: (tmdbId: number) => void;
}) {
  const isFavorite = (tmdbId: number) => favorites.some((f) => f.tmdb_id === tmdbId);
  const full = favorites.length >= 5;

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={full ? "Your 5 favorites are set" : "Search for a movie..."}
          disabled={full}
          className="w-full rounded border border-border bg-surface px-4 py-3 text-foreground placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50"
        />

        {!full && results.length > 0 && (
          <div className="absolute inset-x-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded border border-border bg-surface shadow-2xl">
            {results.map((r) => {
              const already = isFavorite(r.tmdb_id);
              return (
                <button
                  key={r.tmdb_id}
                  type="button"
                  disabled={already}
                  onClick={() => onAdd(r)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {r.poster_path ? (
                    <img
                      src={`${POSTER_THUMB}${r.poster_path}`}
                      alt={r.title}
                      className="h-12 w-8 rounded-sm border border-border object-cover"
                    />
                  ) : (
                    <div className="h-12 w-8 rounded-sm border border-border bg-surface-2" />
                  )}
                  <span className="text-sm text-foreground">
                    {r.title}
                    {r.release_date && (
                      <span className="ml-1 text-muted">({r.release_date.slice(0, 4)})</span>
                    )}
                  </span>
                  {already && <span className="ml-auto text-xs text-muted">Added</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => favorites[i] ?? null).map((f, i) => (
          <div key={f?.tmdb_id ?? `empty-${i}`} className="flex flex-col items-center gap-2">
            <div className="flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded border border-dashed border-border bg-surface-2">
              {f ? (
                f.poster_path ? (
                  <img
                    src={`${POSTER_SLOT}${f.poster_path}`}
                    alt={f.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="px-2 text-center text-xs text-muted">{f.title}</span>
                )
              ) : (
                <span className="text-2xl text-border">+</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => f && onRemove(f.tmdb_id)}
              disabled={!f}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-0"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
