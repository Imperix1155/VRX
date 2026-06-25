/**
 * OpennessIcon — neutral-gray icon badge for instance openness (DESIGN.md §6, R5).
 *
 * Maps InstanceType → one of six shared icons (matching the §6 lookup table).
 * Badge is ALWAYS neutral gray — never platform- or type-colored (§11).
 *
 * Icons are inlined (no global <use> sprite dependency) so they work in
 * renderToStaticMarkup and unit tests.
 */
import type { InstanceType } from '@shared/types'

// ─── Icon paths (mirrored from docs/glass.html symbols) ──────────────────────

function IconPublic(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" />
    </svg>
  )
}

function IconFof(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.3" />
      <path d="M3.4 19c0-3.1 2.5-5.3 5.6-5.3 1.4 0 2.6.4 3.6 1.1" />
      <path d="M17.5 13.5v5M15 16h5" />
    </svg>
  )
}

function IconFriends(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 19c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  )
}

function IconInvite(): React.JSX.Element {
  // Envelope glyph for Invite / Invite+ / Everyone Can Invite / Owner Must Invite (§6)
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 8l9 6 9-6" />
    </svg>
  )
}

function IconGroup(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8.5" cy="9" r="2.7" />
      <circle cx="16" cy="9.5" r="2.2" />
      <path d="M3.5 18c0-2.7 2.2-4.4 5-4.4 1 0 1.9.2 2.7.6" />
      <path d="M13.5 14.4c.7-.3 1.5-.5 2.5-.5 2.5 0 4.5 1.5 4.5 3.6" />
    </svg>
  )
}

function IconOffline(): React.JSX.Element {
  // Slashed-circle for CVR Offline Instance (not joinable, §6)
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M5.7 5.7l12.6 12.6" />
    </svg>
  )
}

// ─── InstanceType → icon component (§6 table) ────────────────────────────────
const OPENNESS_ICON: Record<InstanceType, () => React.JSX.Element> = {
  // VRChat types
  public: IconPublic,
  'group-public': IconPublic,
  'friends-plus': IconFof,
  'group-plus': IconFof,
  friends: IconFriends,
  'invite-plus': IconInvite,
  invite: IconInvite,
  group: IconGroup,
  // CVR types
  'friends-of-friends': IconFof,
  'friends-of-members': IconFof,
  'everyone-can-invite': IconInvite,
  'owner-must-invite': IconInvite,
  'members-only': IconGroup,
  offline: IconOffline
}

interface OpennessIconProps {
  instanceType: InstanceType
  label: string
}

/**
 * Neutral-gray openness badge: icon + platform-true label text (§6, R5).
 * Use the existing INSTANCE_TYPE_LABEL_KEYS i18n label as `label`.
 *
 * Dark:  7% white tinted pill, 13% white border
 * Light: the [data-theme="light"] token overrides flip --border automatically;
 *        we use color-mix against transparent so the badge adapts.
 */
export default function OpennessIcon({
  instanceType,
  label
}: OpennessIconProps): React.JSX.Element {
  const Icon = OPENNESS_ICON[instanceType]
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-[5px]',
        'rounded-full px-[9px] py-[3px]',
        'text-[10.5px] font-bold text-[var(--text-dim)]',
        // Neutral-gray tinted badge — color-mix avoids raw rgba literals
        'bg-[color-mix(in_srgb,var(--text)_7%,transparent)]',
        'border border-[color-mix(in_srgb,var(--text)_13%,transparent)]'
      ].join(' ')}
    >
      <span className="inline-grid place-items-center text-[var(--text-dim)] [&>svg]:block [&>svg]:w-[13px] [&>svg]:h-[13px]">
        <Icon />
      </span>
      {label}
    </span>
  )
}
