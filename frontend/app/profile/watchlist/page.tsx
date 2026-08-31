import TrackedMoviesGrid from "@/components/TrackedMoviesGrid";

export default function WatchlistPage() {
  return (
    <TrackedMoviesGrid
      title="Watchlist"
      endpoint="/watchlist"
      responseKey="watchlist"
      emptyMessage="Your watchlist is empty."
    />
  );
}
