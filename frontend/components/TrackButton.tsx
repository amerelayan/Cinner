"use client";

type Icon = "eye" | "bookmark";

function EyeIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
        fillOpacity={filled ? 0.15 : 0}
      />
      <circle cx="12" cy="12" r="3.2" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.2-7 4.2V4.5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
        fillOpacity={filled ? 1 : 0}
      />
    </svg>
  );
}

export default function TrackButton({
  icon,
  active,
  activeLabel,
  inactiveLabel,
  onClick,
}: {
  icon: Icon;
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent hover:text-accent"
      style={active ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
    >
      {icon === "eye" ? <EyeIcon filled={active} /> : <BookmarkIcon filled={active} />}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] tracking-wide text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {active ? activeLabel : inactiveLabel}
      </span>
    </button>
  );
}
