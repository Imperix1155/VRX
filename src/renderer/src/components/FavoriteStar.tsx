/**
 * Favorite star (owner, 2026-11-01). Friends and worlds both use it. Stars are
 * kept only in VRX; nothing is sent to VRChat or ChilloutVR. The state never
 * rests on color alone: starred is a filled star, not starred is an outline,
 * and the button's name says which.
 */

/** Star glyph (NavIcons dialect, stroke 1.8). Filled when `on`. */
export function StarGlyph({
  on,
  className = 'h-[18px] w-[18px]'
}: {
  on: boolean
  className?: string
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={on ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`flex-none ${className}`}
    >
      <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6Z" />
    </svg>
  )
}

/**
 * The star toggle. `square` (28px) sits beside a sheet's ✕; `round` (32px
 * glass) sits beside the friend details bell. `aria-pressed` carries the
 * state for assistive tech; the label stays the same in both states.
 */
export function FavoriteStarButton({
  on,
  disabled,
  label,
  hint,
  onToggle,
  shape = 'square',
  className = ''
}: {
  on: boolean
  disabled?: boolean
  /** Names the toggle, the same in both states, e.g. "Favorite Alex". */
  label: string
  /** Tooltip naming what a press does, e.g. "Add to favorites". */
  hint: string
  onToggle: () => void
  shape?: 'square' | 'round'
  className?: string
}): React.JSX.Element {
  const frame =
    shape === 'round'
      ? 'glass h-[var(--space-8)] w-[var(--space-8)] rounded-full focus-visible:ring-2'
      : 'h-[28px] w-[28px] rounded-[9px] hover:bg-[var(--surface-hover)] focus-visible:ring-1'
  return (
    <button
      type="button"
      data-favorite-star=""
      aria-pressed={on}
      aria-label={label}
      title={hint}
      disabled={disabled}
      onClick={onToggle}
      className={`favorite-star grid place-items-center focus:outline-none focus-visible:ring-[var(--text-dim)] disabled:opacity-50 ${frame} ${className}`}
    >
      <StarGlyph on={on} className="h-[17px] w-[17px]" />
    </button>
  )
}
