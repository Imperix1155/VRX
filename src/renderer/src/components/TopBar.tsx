import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SETTINGS_CATEGORIES, useUiStore, type SettingsCategory } from '../stores/ui'
import { useFriends } from '../queries/friends'
import { useSegmentedBubble } from '../hooks/useSegmentedBubble'
import SegmentedControl from './SegmentedControl'
import { focusRadioSibling, segArrowTarget } from '../utils/segmented'
import { VIEW_TITLE_KEYS } from '../utils/viewTitles'

/** Platform filter for the segmented control. */
export type PlatformFilter = 'all' | 'vrchat' | 'chilloutvr'

// Order: VRChat | All | ChilloutVR — "All" sits in the MIDDLE because it mixes the
// two platforms, so it reads between them (DESIGN.md §8/§9.1). Labels are text-only
// acronyms; the platform color is applied to the WORD itself (no glyph chip).
const SEG_ITEMS: Array<{ id: PlatformFilter; key: string; color: string | null }> = [
  { id: 'vrchat', key: 'shell.seg.vrchatShort', color: 'var(--vrc)' },
  { id: 'all', key: 'shell.seg.allShort', color: null },
  { id: 'chilloutvr', key: 'shell.seg.chilloutvrShort', color: 'var(--cvr)' }
]

// Category nav labels reuse the settings section-heading keys — one string per
// concept (the sections' h2s are sr-only; this nav is their visible label).
const CATEGORY_LABEL_KEYS: Record<SettingsCategory, string> = {
  appearance: 'settings.appearance.heading',
  dashboard: 'settings.dashboard.heading'
}

// The platform filter is its OWN component so useSegmentedBubble mounts and
// unmounts WITH the track it measures. When the hook lived in TopBar (which
// never unmounts), swapping to Settings left its ResizeObserver watching the
// detached track — the observer fires on detach with width 0 and the bubble
// rendered 0-wide after every Settings round-trip (advisor finding, VRX-186).
// The `platform` STATE stays lifted in TopBar so the selection survives the swap.
function PlatformFilter({
  platform,
  onChange
}: {
  platform: PlatformFilter
  onChange: (next: PlatformFilter) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const activeIndex = SEG_ITEMS.findIndex((s) => s.id === platform)

  // Sliding bubble measured from the active button (labels are unequal widths —
  // the shared hook owns the recipe; also used by SegmentedControl, VRX-183).
  const { trackRef, bubble } = useSegmentedBubble(activeIndex)

  return (
    <>
      {/* Segmented control (§9: one bubble element, never per-button bg).
      Radius: the track uses .glass's 20px panel radius — a `rounded-[..]` utility
      here is DEAD (.glass is un-layered, so it overrides Tailwind utilities), so
      the bubble below is rounded-[16px] (= 20px − 4px inset) to seat concentrically. */}
      {/* A11y (audit W5): a segmented control is a single-select group → radiogroup
      semantics with a roving tabindex (one Tab stop; arrows move the selection),
      not N independent toggle buttons announced as pressed/unpressed. */}
      <div
        ref={trackRef}
        className="glass relative flex p-[4px] gap-[2px] ml-[6px]"
        role="radiogroup"
        aria-label={t('shell.seg.aria')}
      >
        {/* Sliding bubble — left/width measured from the active button (see above) */}
        <span
          className="absolute top-[4px] bottom-[4px] rounded-[16px] pointer-events-none motion-safe:transition-all motion-safe:duration-200"
          style={{
            left: `${bubble.left}px`,
            width: `${bubble.width}px`,
            background: 'var(--seg-bubble-bg)',
            boxShadow: 'var(--seg-bubble-shadow)'
          }}
          aria-hidden="true"
        />
        {SEG_ITEMS.map(({ id, key, color }, index) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={platform === id}
            tabIndex={platform === id ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => {
              const next = segArrowTarget(e.key, index, SEG_ITEMS.length)
              if (next === null) return
              const target = SEG_ITEMS[next]
              if (target === undefined) return // modulo keeps next in range; narrows the index
              e.preventDefault()
              onChange(target.id)
              focusRadioSibling(e.currentTarget, next)
            }}
            className={[
              'relative z-10 flex-1 text-[12.5px] font-bold uppercase tracking-wide px-[13px] py-[6px] rounded-[9px]',
              'inline-flex items-center justify-center border-0 bg-transparent cursor-pointer',
              'motion-safe:transition-colors',
              // Platform words carry their own color always; "All" is neutral
              // (active = full text, inactive = dim).
              color != null ? '' : platform === id ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
            ].join(' ')}
            style={color != null ? { color } : undefined}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </>
  )
}

export default function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const settingsCategory = useUiStore((s) => s.settingsCategory)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  const [platform, setPlatform] = useState<PlatformFilter>('all')

  // Real online count for the §8 status indicator — total across platforms.
  // Online = active OR in-game presence (same definition as the dashboard's
  // getDashboardStats). The friends queries are already cached (Friends/Dashboard
  // views), so this re-uses them rather than fetching again.
  const vrcFriends = useFriends('vrchat').data ?? []
  const cvrFriends = useFriends('chilloutvr').data ?? []
  const onlineCount = [...vrcFriends, ...cvrFriends].filter(
    (f) => f.presence.state === 'active' || f.presence.state === 'in-game'
  ).length

  return (
    <div className="flex items-center gap-[18px] mb-[22px]">
      {/* View title */}
      <h1 className="text-[25px] font-extrabold tracking-[-0.4px] text-[var(--text)] shrink-0">
        {t(VIEW_TITLE_KEYS[activeTab])}
      </h1>

      {/* CONTEXTUAL SLOT (owner, VRX-186): the top-bar control belongs to the
          active view. Settings has no use for a platform filter — it shows the
          settings CATEGORY nav here instead (mini-pages, §8 no-scroll rule). */}
      {activeTab === 'settings' ? (
        <div className="ml-[6px]">
          <SegmentedControl
            values={SETTINGS_CATEGORIES}
            active={settingsCategory}
            labelKeys={CATEGORY_LABEL_KEYS}
            ariaLabel={t('settings.categories.aria')}
            onChange={setSettingsCategory}
          />
        </div>
      ) : (
        <PlatformFilter platform={platform} onChange={setPlatform} />
      )}
      {/* Online count with green pulse (§8) */}
      <div className="ml-auto text-[13px] text-[var(--text-dim)] flex items-center gap-[8px]">
        {/* Pulse dot — no keyframes in v1; motion-safe guard if animation is added later */}
        <span
          className="w-[8px] h-[8px] rounded-full flex-none"
          style={{
            background: 'var(--ingame)',
            boxShadow: '0 0 10px var(--ingame)'
          }}
          aria-hidden="true"
        />
        {t('shell.onlineCount', { count: onlineCount })}
      </div>
    </div>
  )
}
