"use client";

type Icon = "eye" | "bookmark";
type Size = "sm" | "md";

const SIZES: Record<Size, { button: string; icon: string; tooltip: string }> = {
  md: { button: "h-11 w-11", icon: "h-6 w-6", tooltip: "-top-9" },
  sm: { button: "h-8 w-8", icon: "h-4 w-4", tooltip: "-top-7" },
};

function EyeIcon({ filled, className }: { filled: boolean; className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
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

function BookmarkIcon({ filled, className }: { filled: boolean; className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
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
  size = "md",
}: {
  icon: Icon;
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onClick: () => void;
  size?: Size;
}) {
  const s = SIZES[size];
  return (
    <button
      onClick={onClick}
      className={`group relative flex ${s.button} items-center justify-center rounded-full border border-border bg-black/70 text-foreground shadow-md transition-colors hover:border-accent hover:text-accent`}
      style={active ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
    >
      {icon === "eye" ? (
        <EyeIcon filled={active} className={s.icon} />
      ) : (
        <BookmarkIcon filled={active} className={s.icon} />
      )}
      <span
        className={`pointer-events-none absolute ${s.tooltip} left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] tracking-wide text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100`}
      >
        {active ? activeLabel : inactiveLabel}
      </span>
    </button>
  );
}
