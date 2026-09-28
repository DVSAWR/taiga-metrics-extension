const HISTOGRAM = [
  "M3 3v18h18",
  "M20 18v3",
  "M16 16v5",
  "M12 13v8",
  "M8 16v5",
  "M3 11c6 0 5 -5 9 -5s3 5 9 5",
];
const COLOR = "#00364a";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {HISTOGRAM.map((path) => (
        <path
          key={path}
          d={path}
          fill="none"
          stroke={COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
