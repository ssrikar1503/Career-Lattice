/**
 * The Career Lattice mark: a branching path climbing upward.
 * One entry point, two directions up - the whole product in one glyph.
 * Renders transparent, for use on maroon (default) or light backgrounds.
 */
export default function Logo({
  size = 28,
  onLight = false,
}: {
  size?: number;
  onLight?: boolean;
}) {
  const line = onLight ? '#B7791F' : '#D9B26A';
  const node = onLight ? '#500000' : '#F3E9DC';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M14 50 L32 32 L50 14 M32 32 L50 44"
        stroke={line}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="50" r="6.5" fill={node} stroke={line} strokeWidth="3" />
      <circle cx="32" cy="32" r="6.5" fill={node} stroke={line} strokeWidth="3" />
      <circle cx="50" cy="14" r="6.5" fill={node} stroke={line} strokeWidth="3" />
      <circle cx="50" cy="44" r="6.5" fill={node} stroke={line} strokeWidth="3" />
    </svg>
  );
}
