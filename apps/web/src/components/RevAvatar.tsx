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

/**
 * Chat theme per industry, derived from the same grid palette as the avatar:
 * deep + mid make the header gradient, mid colors the user bubbles, buttons
 * and the launcher border, accent is the underline.
 */
export const REV_THEME: Record<string, { deep: string; mid: string; accent: string }> = {
  semiconductors: { deep: '#1e1b4b', mid: '#7c3aed', accent: '#06b6d4' },
  space: { deep: '#241a52', mid: '#c026d3', accent: '#ea580c' },
  'additive-manufacturing': { deep: '#172554', mid: '#0891b2', accent: '#65a30d' },
};

export function revTheme(slug: string) {
  return REV_THEME[slug] ?? REV_THEME.semiconductors;
}

interface Props {
  slug: string;
  /** Size the avatar via w-/h- classes; ring classes welcome too. */
  className?: string;
}

export default function RevAvatar({ slug, className = '' }: Props) {
  const src = ART[slug] ?? ART.semiconductors;
  return (
    <span
      className={`relative inline-block flex-shrink-0 ${className}`}
      aria-hidden="true"
    >
      <Image src={src} alt="" fill sizes="64px" className="object-contain" />
    </span>
  );
}
