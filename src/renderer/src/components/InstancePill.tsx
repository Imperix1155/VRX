/**
 * InstancePill — the canonical instance-type ("openness") pill (VRX-198).
 *
 * ONE component for both the Friends list and the Dashboard hot-instance cards,
 * so the pill looks identical everywhere (owner's consistency rule, 2026-07-08).
 * Word-only (no icon), `rounded-[10px]`, tier-colored via the §6 `--op-*` openness
 * ladder (green open → orange locked; purple = groups); a neutral readable pill
 * for the hueless cases (Private / CVR Offline Instance, `tier = null`).
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
  /** Openness tier → `--op-*` tokens; `null` = neutral (Private / CVR Offline). */
  tier: OpennessTier | null
  /** Layout extras from the consumer (width floor, grid placement). */
  className?: string
  /** Present only for actionable friend-row pills. */
  onJoin?: React.MouseEventHandler<HTMLButtonElement>
  /** Accessible action name for the button variant. */
  'aria-label'?: string
}

export default function InstancePill({
  label,
  tier,
  className = '',
  onJoin,
  'aria-label': ariaLabel
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
        type="button"
        onClick={onJoin}
        aria-label={ariaLabel}
        className={`${pillClass} cursor-pointer hover:bg-[var(--control-fill-hover)] active:bg-[var(--control-fill)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors`}
        style={style}
      >
        {label}
      </button>
    )
  }

  return (
    <span className={pillClass} style={style}>
      {label}
    </span>
  )
}
