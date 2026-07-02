import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '../stores/ui'
import { useFriends } from '../queries/friends'
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

export default function TopBar(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const [platform, setPlatform] = useState<PlatformFilter>('all')

  const activeIndex = SEG_ITEMS.findIndex((s) => s.id === platform)

  // Sliding bubble: measure the ACTIVE button's real left/width. The labels are
  // unequal widths (e.g. "All" vs "ChilloutVR"), so a fixed 1/3-width bubble can't
  // line up — it has to track the actual button box. useLayoutEffect places it
  // before paint; the ResizeObserver keeps it aligned when the window resizes.
  const trackRef = useRef<HTMLDivElement>(null)
  const [bubble, setBubble] = useState<{ left: number; width: number }>({ left: 4, width: 0 })
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    let cancelled = false
    const place = (): void => {
      if (cancelled) return
      const btn = track.querySelectorAll('button')[activeIndex] as HTMLElement | undefined
      if (btn) setBubble({ left: btn.offsetLeft, width: btn.offsetWidth })
    }
    place()
    // Re-measure once layout settles (next frame) and after web fonts load — the
    // first paint can measure stale (too-narrow) label widths otherwise.
    const raf = requestAnimationFrame(place)
    document.fonts?.ready.then(place).catch(() => {})
    const ro = new ResizeObserver(place)
    ro.observe(track)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // i18n.language: the labels re-render with new (differently-sized) text on a
    // language switch, so the bubble must re-measure or it seats on stale widths
    // (audit W5 — the ResizeObserver watches the TRACK, which may not resize).
  }, [activeIndex, i18n.language])

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
            onClick={() => setPlatform(id)}
            onKeyDown={(e) => {
              const next = segArrowTarget(e.key, index, SEG_ITEMS.length)
              if (next === null) return
              const target = SEG_ITEMS[next]
              if (target === undefined) return // modulo keeps next in range; narrows the index
              e.preventDefault()
              setPlatform(target.id)
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
