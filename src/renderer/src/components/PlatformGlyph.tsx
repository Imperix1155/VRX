/**
 * PlatformGlyph — small VT323 platform-tinted square badge (DESIGN.md §7/§238).
 *
 * Renders `V` (VRChat) or `C` (ChilloutVR) in a platform-colored rounded square.
 * This is the ONLY platform-color carrier in the name line (§5 / §9).
 * Colors use color-mix() against the CSS var tokens so they flip in light mode.
 */
import type { Platform } from '@shared/types'

interface PlatformGlyphProps {
  platform: Platform
}

export default function PlatformGlyph({ platform }: PlatformGlyphProps): React.JSX.Element {
  const isVrc = platform === 'vrchat'

  // bg: 20% platform color mixed into transparent.
  // text: dark mode → 74% platform color into white (light glyph on dark bg);
  //       light mode → 82% platform color into black (dark glyph on light bg, matching
  //       glass.html reference: vrc #0f4f9c / cvr #a3410d territory).
  const bgClass = isVrc
    ? 'bg-[color-mix(in_srgb,var(--vrc)_20%,transparent)]'
    : 'bg-[color-mix(in_srgb,var(--cvr)_20%,transparent)]'
  const textClass = isVrc
    ? 'text-[color-mix(in_srgb,var(--vrc)_74%,white)] [[data-theme=light]_&]:text-[color-mix(in_srgb,var(--vrc)_82%,black)]'
    : 'text-[color-mix(in_srgb,var(--cvr)_74%,white)] [[data-theme=light]_&]:text-[color-mix(in_srgb,var(--cvr)_82%,black)]'

  return (
    <span
      aria-label={isVrc ? 'VRChat' : 'ChilloutVR'}
      className={[
        'inline-grid place-items-center shrink-0',
        'w-[19px] h-[19px] rounded-[6px]',
        'text-[10px] font-extrabold font-mono',
        bgClass,
        textClass
      ].join(' ')}
    >
      {isVrc ? 'V' : 'C'}
    </span>
  )
}
