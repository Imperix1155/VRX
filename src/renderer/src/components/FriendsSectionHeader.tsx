import { useTranslation } from 'react-i18next'
import type { FriendListSection } from '@shared/types'

/** Section header i18n keys (VRX-67) — a lookup map, not template-literal keys,
 *  so the i18n key-existence scan (parity.test.ts) can see them (quoted literals). */
const SECTION_LABEL_KEY: Record<FriendListSection, string> = {
  favorites: 'friends.section.favorites',
  'in-game': 'friends.section.inGame',
  online: 'friends.section.online',
  offline: 'friends.section.offline'
}

/**
 * Chevron glyph for a collapsible section header — rotates -90° when
 * collapsed (§5: a non-color signifier, `aria-expanded` is the real a11y
 * state; this is the visual echo).
 */
function ChevronGlyph({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-[14px] w-[14px] shrink-0 motion-safe:transition-transform ${
        collapsed ? '-rotate-90' : ''
      }`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/**
 * Collapsible presence-section header (VRX-67). A real `<button>` with
 * `aria-expanded` — keyboard accessible for free. The virtual-row wrapper owns
 * sticky positioning so the active header remains mounted outside its natural
 * range; this button keeps the opaque background that prevents row bleed.
 */
export default function FriendsSectionHeader({
  section,
  count,
  collapsed,
  onToggle,
  collapseIgnored,
  tabIndex,
  setButtonElement,
  onFocus,
  onBlur
}: {
  section: FriendListSection
  count: number
  collapsed: boolean
  onToggle: () => void
  collapseIgnored: boolean
  tabIndex: 0 | -1
  setButtonElement: (section: FriendListSection, element: HTMLButtonElement | null) => void
  onFocus: (section: FriendListSection) => void
  onBlur: (section: FriendListSection) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      ref={(element) => setButtonElement(section, element)}
      type="button"
      onClick={onToggle}
      onFocus={() => onFocus(section)}
      onBlur={() => onBlur(section)}
      disabled={collapseIgnored}
      tabIndex={collapseIgnored ? -1 : tabIndex}
      aria-expanded={!collapsed}
      // All sections share one virtual list, so no header claims that whole
      // list as its controlled object. aria-expanded carries disclosure state.
      className={[
        'flex w-full items-center gap-[var(--space-2)]',
        'glass-layer rounded-control px-[var(--space-2)] py-[var(--space-1)]',
        'text-xs font-semibold tracking-widest text-[var(--text-dim)] uppercase',
        'hover:bg-[color-mix(in_srgb,var(--glass-layer),var(--text)_8%)] disabled:cursor-default disabled:hover:bg-[var(--glass-layer)] motion-safe:transition-colors'
      ].join(' ')}
    >
      <ChevronGlyph collapsed={collapsed} />
      {t(SECTION_LABEL_KEY[section], { count })}
    </button>
  )
}
