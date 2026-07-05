/**
 * dolphIQ icon — geometric minimal dolphin silhouette.
 *
 * Single-color path (uses currentColor) so it inherits text color from any
 * parent — works on coloured industry backgrounds, dark chat panels, etc.
 *
 * Pose: leaping dolphin, head right, dorsal fin centered. The shape is
 * a single closed body path + dorsal fin triangle + eye dot.
 */
interface Props {
  className?: string;
  /** Apply a subtle white eye highlight (defaults to true). */
  showEye?: boolean;
}

export default function DolphIQIcon({ className = '', showEye = true }: Props) {
  return (
    <svg
      viewBox="0 0 64 40"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Body — streamlined leaping dolphin, head facing right */}
      <path d="M 58 24
               C 60 18, 58 12, 50 10
               C 38 8, 26 12, 16 18
               L 8 14
               L 12 18
               L 4 20
               L 12 22
               L 6 28
               L 14 24
               C 24 28, 38 28, 48 26
               C 54 25, 58 25, 58 24 Z" />
      {/* Dorsal fin — triangular */}
      <path d="M 30 13 L 36 4 L 40 13 Z" />
      {/* Eye */}
      {showEye && <circle cx="48" cy="18" r="1.3" fill="white" />}
    </svg>
  );
}

/**
 * dolphIQ wordmark — styled text component.
 *
 * Renders as "dolph" + "IQ" with the IQ visually distinct (bolder / accented).
 * This is the textual brand: dolph + IQ, supporting both pronunciations
 * "DOL-fik" and "DOL-fee-q".
 */
interface WordmarkProps {
  className?: string;
}

export function DolphIQWordmark({ className = '' }: WordmarkProps) {
  return (
    <span className={className}>
      <span>dolph</span>
      <span className="font-extrabold tracking-tight">IQ</span>
    </span>
  );
}
