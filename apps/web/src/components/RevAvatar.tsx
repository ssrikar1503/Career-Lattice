import Image from 'next/image';

/**
 * Rev's portrait - the cubist collie artwork, recolored per industry so the
 * avatar's facets use the same cluster palette as that industry's career grid
 * (see CareerMap/constants.ts). Falls back to the semiconductors art for any
 * unknown slug.
 */
const ART: Record<string, string> = {
  semiconductors: '/rev/rev-semiconductors.png',
  space: '/rev/rev-space.png',
  'additive-manufacturing': '/rev/rev-additive-manufacturing.png',
};

interface Props {
  slug: string;
  /** Size the avatar via w-/h- classes; ring classes welcome too. */
  className?: string;
}

export default function RevAvatar({ slug, className = '' }: Props) {
  const src = ART[slug] ?? ART.semiconductors;
  return (
    <span
      className={`relative inline-block rounded-full overflow-hidden bg-white flex-shrink-0 ${className}`}
      aria-hidden="true"
    >
      <Image src={src} alt="" fill sizes="64px" className="object-cover" />
    </span>
  );
}
