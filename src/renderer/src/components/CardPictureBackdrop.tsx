/**
 * World picture behind a Dashboard bar card (owner, 2026-10-18: the second
 * Dashboard section keeps its compact bar and gains the world thumbnail).
 *
 * Layers, bottom to top: the card's own information backing → the picture →
 * a scrim in that SAME backing color (strong on the text side, lighter on the
 * right) → the card's platform tint gradient again. Re-applying the tint above
 * the picture keeps blue/orange readable at a glance, and the scrim keeps text
 * contrast independent of the picture (DESIGN.md §2: background color must not
 * alter information-bearing cards). The picture is decorative: no alt text,
 * and a missing or failed image renders nothing, leaving today's plain bar.
 */
import type { Platform } from '@shared/types'

export function CardPictureBackdrop({
  image,
  platform,
  onError
}: {
  /** A main-issued `data:` URL, or null while unknown/failed. */
  image: string | null
  platform: Platform
  onError: () => void
}): React.JSX.Element | null {
  if (image === null) return null
  const backing = (pct: number): string =>
    `color-mix(in srgb, var(--glass-information) ${pct}%, transparent)`
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={onError}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(90deg, ${backing(90)} 0%, ${backing(80)} 45%, ${backing(62)} 100%)`
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: platform === 'vrchat' ? 'var(--tint-vrc-bg)' : 'var(--tint-cvr-bg)'
        }}
      />
    </div>
  )
}

/**
 * Gives a pill a small backing in the card's own color while a picture sits
 * behind it, so the pill's word stays readable. Without a picture it is a
 * plain wrapper and the pill looks exactly as it does today.
 */
export function PictureBackedPill({
  backed,
  className = '',
  children
}: {
  backed: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={`relative block rounded-[10px] ${className}`}
      style={
        backed
          ? { background: 'color-mix(in srgb, var(--glass-information) 78%, transparent)' }
          : undefined
      }
    >
      {children}
    </span>
  )
}
