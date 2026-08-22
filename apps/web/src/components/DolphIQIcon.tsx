/**
 * Rev icon - a compass rose mark for the AI career guide.
 * Neutral original artwork (no university trademarks). Uses currentColor
 * so it inherits its color; wrap in the chip variant on maroon surfaces.
 */
interface Props {
  className?: string;
  /** Render inside a white circular chip - use on maroon backgrounds. */
  chip?: boolean;
}

export default function DolphIQIcon({ className = '', chip = false }: Props) {
  const svg = (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={chip ? 'w-full h-full p-[5px] text-[#500000]' : className}
      fill="none"
      aria-hidden="true"
    >
      {/* Outer ring */}
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="3" />
      {/* Compass needle: north in solid, south in gold */}
      <path d="M24 6 L29 24 L24 21.5 L19 24 Z" fill="currentColor" />
      <path d="M24 42 L19 24 L24 26.5 L29 24 Z" fill="#B7791F" />
      {/* East-west ticks */}
      <path d="M8 24 L13 24 M35 24 L40 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Center pivot */}
      <circle cx="24" cy="24" r="2.4" fill="#B7791F" />
    </svg>
  );
  if (!chip) return svg;
  return (
    <span className={`inline-flex items-center justify-center rounded-full bg-white overflow-hidden ${className}`}>
      {svg}
    </span>
  );
}

/**
 * Rev wordmark - set in the site's serif brand face.
 */
interface WordmarkProps {
  className?: string;
}

export function DolphIQWordmark({ className = '' }: WordmarkProps) {
  return (
    <span
      className={`font-bold ${className}`}
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      Rev
    </span>
  );
}
