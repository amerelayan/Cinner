import TrackedMoviesGrid from "@/components/TrackedMoviesGrid";

export default function WatchedPage() {
  return (
    <TrackedMoviesGrid
      title="Watched"
      endpoint="/watched"
      responseKey="watched"
      emptyMessage="You haven't marked any movies as watched yet."
    />
  );
}
