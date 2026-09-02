import FilmReelIcon from "@/components/FilmReelIcon";

const SIZES = {
  sm: "h-6 w-6",
  md: "h-10 w-10",
  lg: "h-14 w-14",
} as const;

export default function LoadingSpinner({
  label,
  size = "md",
}: {
  label?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div style={{ color: "#e0262e" }}>
        <FilmReelIcon className={`${SIZES[size]} cinner-spin`} />
      </div>
      {label && <p className="max-w-sm text-center text-sm text-muted">{label}</p>}
    </div>
  );
}
