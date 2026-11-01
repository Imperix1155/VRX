/**
 * Favorite star (owner, 2026-11-01). Friends and worlds both use it. The
 * state never rests on color alone: starred is a filled star, not starred is
 * an outline, and the button's name says which.
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
 * The star button. It opens the favorite panel (FavoriteMenu), so it is a
 * disclosure: `aria-expanded` says whether the panel shows, and the name says
 * whether the item is starred. `square` (28px) sits beside a sheet title;
 * `round` (32px glass) sits beside the friend details bell.
 */
export function FavoriteStarButton({
  ref,
  on,
  disabled,
  label,
  hint,
  expanded,
  controls,
  onToggle,
  shape = 'square',
  className = ''
}: {
  ref?: React.Ref<HTMLButtonElement>
  on: boolean
  disabled?: boolean
  /** Names the button and says whether the item is starred. */
  label: string
  /** Tooltip naming what a press does. */
  hint: string
  expanded: boolean
  controls: string
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
      ref={ref}
      type="button"
      data-favorite-star=""
      data-on={on}
      aria-expanded={expanded}
      aria-controls={controls}
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
