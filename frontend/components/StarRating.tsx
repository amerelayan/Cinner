"use client";

import { useState } from "react";

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.7 1.5 6.9L12 17.8l-6.1 3.4 1.5-6.9-5.2-4.7 6.9-.7L12 2.5z" />
    </svg>
  );
}

export default function StarRating({
  value,
  onRate,
  onClear,
}: {
  value: number | null;
  onRate: (rating: number) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  if (!editing) {
    if (value === null) {
      return (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          <StarIcon filled={false} className="h-4 w-4" />
          Rate
        </button>
      );
    }
    return (
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-accent">
          <StarIcon filled className="h-5 w-5" />
          <span className="text-foreground">{value}/10</span>
        </span>
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-muted transition-colors hover:text-accent"
        >
          Edit rating
        </button>
      </div>
    );
  }

  const display = hover ?? value ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Rate ${n}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => {
              onRate(n);
              setEditing(false);
            }}
          >
            <StarIcon
              filled={display >= n}
              className={`h-5 w-5 transition-colors ${display >= n ? "text-accent" : "text-border"}`}
            />
          </button>
        ))}
      </div>
      {value !== null && (
        <button
          onClick={() => {
            onClear();
            setEditing(false);
          }}
          className="text-xs text-muted transition-colors hover:text-accent"
        >
          Remove
        </button>
      )}
      <button
        onClick={() => setEditing(false)}
        className="text-xs text-muted transition-colors hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
