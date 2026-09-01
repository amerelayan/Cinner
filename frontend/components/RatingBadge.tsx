type Source = "imdb" | "rt" | "cinner";

const CONFIG: Record<Source, { label: string; color: string; bg: string }> = {
  imdb: { label: "IMDb", color: "#0a0908", bg: "#f5c518" },
  rt: { label: "RT", color: "#ffffff", bg: "#fa320a" },
  cinner: { label: "Cinner", color: "#ffffff", bg: "var(--accent)" },
};

function SourceIcon({ source }: { source: Source }) {
  if (source === "rt") {
    // A plain, generic tomato shape (not Rotten Tomatoes' actual logo artwork).
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path d="M11 4c.5-1.2 1.8-2 3-1.7-.3 1-1.1 1.7-2 2" stroke="#3a7d33" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="13" r="8" fill="currentColor" />
      </svg>
    );
  }
  if (source === "imdb") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path
          d="M12 2l2.6 6.6L21 9l-5 4.5L17.5 21 12 17.2 6.5 21 8 13.5 3 9l6.4-.4L12 2z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return <FilmReelIconInline />;
}

function FilmReelIconInline() {
  return (
    <svg viewBox="0 0 32 32" className="h-4 w-4" fill="none">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
      <circle cx="16" cy="6" r="2.6" fill="currentColor" />
      <circle cx="25" cy="12.5" r="2.6" fill="currentColor" />
      <circle cx="21.5" cy="23" r="2.6" fill="currentColor" />
      <circle cx="10.5" cy="23" r="2.6" fill="currentColor" />
      <circle cx="7" cy="12.5" r="2.6" fill="currentColor" />
    </svg>
  );
}

export default function RatingBadge({
  source,
  value,
  suffix = "",
}: {
  source: Source;
  value: string | number | null;
  suffix?: string;
}) {
  const { label, color, bg } = CONFIG[source];
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <span
        className="flex h-6 w-6 items-center justify-center rounded"
        style={{ backgroundColor: bg, color }}
      >
        <SourceIcon source={source} />
      </span>
      <div className="leading-tight">
        <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
        <p className="text-sm text-foreground">{value !== null ? `${value}${suffix}` : "—"}</p>
      </div>
    </div>
  );
}
