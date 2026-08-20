import Image from 'next/image';

/**
 * Rev icon - the Reveille silhouette (Texas A&M's First Lady of Aggieland).
 * The artwork is maroon-on-transparent, so on maroon surfaces wrap it in a
 * white chip (chip prop) to keep contrast.
 */
interface Props {
  className?: string;
  /** Render inside a white circular chip - use on maroon backgrounds. */
  chip?: boolean;
}

export default function DolphIQIcon({ className = '', chip = false }: Props) {
  const img = (
    <Image
      src="/reveille.webp"
      alt=""
      width={64}
      height={63}
      className={chip ? 'w-full h-full object-contain p-[3px]' : className}
      aria-hidden="true"
    />
  );
  if (!chip) return img;
  return (
    <span className={`inline-flex items-center justify-center rounded-full bg-white overflow-hidden ${className}`}>
      {img}
    </span>
  );
}

/**
 * Rev wordmark - Reveille's nickname, set in the site's serif brand face.
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
