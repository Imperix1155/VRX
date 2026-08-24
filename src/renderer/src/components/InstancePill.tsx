/**
 * InstancePill — the canonical instance-type ("openness") pill (VRX-198).
 *
 * ONE component for the Friends list, the Dashboard hot-instance cards, the
 * FriendDrawer, and JoinConfirmDialog (VRX-245), so the pill looks identical
 * everywhere (owner's consistency rule, 2026-07-08).
 * Word-only (no icon), `rounded-[10px]`, tier-colored via the §6 `--op-*` openness
 * ladder (green open → orange locked; purple = groups); a neutral readable pill
 * for the hueless cases (Private / CVR Offline Instance / Unknown, `tier = null`
 * — Unknown per VRX-244: unreadable CVR privacy reuses THIS neutral treatment,
 * never a new one; the pill's word is what discriminates the three).
 *
 * Geometry only (`PILL_BASE`) — no `min-width`: consumers own the width floor via
 * their layout (FriendsList passes `min-w-[78px]`; the Dashboard floors the shared
 * pill COLUMN with `minmax(78px, max-content)`, avoiding the min-width-plus-grid-
 * stretch inflation artifact). Tier map + geometry live in `utils/instancePill`.
 */
import { PILL_BASE, type OpennessTier } from '../utils/instancePill'

interface InstancePillProps {
  /** The already-resolved, i18n'd label to show (scheme resolution stays with the caller). */
  label: string
  /** Openness tier → `--op-*` tokens; `null` = neutral (Private / CVR Offline / Unknown, VRX-244). */
  tier: OpennessTier | null
  /** Layout extras from the consumer (width floor, grid placement). */
  className?: string
  /** Present only for actionable friend-row pills. */
  onJoin?: React.MouseEventHandler<HTMLButtonElement>
  /** Disables the actionable variant while its row's join request is pending. */
  disabled?: boolean
  /** Accessible action name for the button variant. */
  'aria-label'?: string
  /** Consumer-owned sequential focus policy for the actionable variant. */
  tabIndex?: number
}

export default function InstancePill({
  label,
  tier,
  className = '',
  onJoin,
  disabled = false,
  'aria-label': ariaLabel,
  tabIndex
}: InstancePillProps): React.JSX.Element {
  const style: React.CSSProperties & { '--instance-pill-bg': string } =
    tier != null
      ? {
          color: `var(--op-${tier}-text)`,
          '--instance-pill-bg': `color-mix(in srgb, var(--op-${tier}) 13%, transparent)`,
          borderColor: `color-mix(in srgb, var(--op-${tier}) 36%, transparent)`
        }
      : {
          color: 'var(--text-dim)',
          '--instance-pill-bg': 'color-mix(in srgb, var(--text) 7%, transparent)',
          borderColor: 'color-mix(in srgb, var(--text) 16%, transparent)'
        }
  const pillClass = `${PILL_BASE} bg-[var(--instance-pill-bg)] ${className}`

  if (onJoin) {
    return (
      <button
        data-instance-pill=""
        type="button"
        onClick={onJoin}
        disabled={disabled}
        aria-label={ariaLabel}
        tabIndex={tabIndex}
        className={`${pillClass} cursor-pointer hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:opacity-50 motion-safe:transition-[filter,color]`}
        style={style}
      >
        {label}
      </button>
    )
  }

  return (
    <span data-instance-pill="" className={pillClass} style={style}>
      {label}
    </span>
  )
}
