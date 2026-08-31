"use client";

import { useState } from "react";

function Star({ fraction }: { fraction: number }) {
  return (
    <div className="relative h-7 w-7">
      <svg viewBox="0 0 24 24" className="absolute inset-0 h-7 w-7 text-border" fill="currentColor">
        <path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.7 1.5 6.9L12 17.8l-6.1 3.4 1.5-6.9-5.2-4.7 6.9-.7L12 2.5z" />
      </svg>
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${fraction * 100}%` }}>
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-accent" fill="currentColor">
          <path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.7 1.5 6.9L12 17.8l-6.1 3.4 1.5-6.9-5.2-4.7 6.9-.7L12 2.5z" />
        </svg>
      </div>
    </div>
  );
}

export default function StarRating({
  value,
  onRate,
}: {
  value: number | null;
  onRate: (rating: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const display = hover ?? value ?? 0;

  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fraction = Math.min(1, Math.max(0, display / 2 - (i - 1)));
        return (
          <div key={i} className="relative">
            <Star fraction={fraction} />
            <button
              type="button"
              aria-label={`Rate ${i * 2 - 1}`}
              className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
              onMouseEnter={() => setHover(i * 2 - 1)}
              onClick={() => onRate(i * 2 - 1)}
            />
            <button
              type="button"
              aria-label={`Rate ${i * 2}`}
              className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
              onMouseEnter={() => setHover(i * 2)}
              onClick={() => onRate(i * 2)}
            />
          </div>
        );
      })}
      {value !== null && (
        <span className="ml-2 text-sm text-muted">{value.toFixed(1)}/10</span>
      )}
    </div>
  );
}
