import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore, type ActiveTab } from '../stores/ui'

/** Platform filter for the segmented control. */
export type PlatformFilter = 'all' | 'vrchat' | 'chilloutvr'

const VIEW_TITLE_KEYS: Record<ActiveTab, string> = {
  dashboard: 'shell.nav.dashboard',
  activity: 'shell.nav.activity',
  friends: 'shell.nav.friends',
  instances: 'shell.nav.instances',
  groups: 'shell.nav.groups',
  settings: 'shell.nav.settings'
}

const SEG_ITEMS: Array<{ id: PlatformFilter; key: string }> = [
  { id: 'all', key: 'shell.seg.all' },
  { id: 'vrchat', key: 'shell.seg.vrchat' },
  { id: 'chilloutvr', key: 'shell.seg.chilloutvr' }
]

export default function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const [platform, setPlatform] = useState<PlatformFilter>('all')

  const activeIndex = SEG_ITEMS.findIndex((s) => s.id === platform)

  return (
    <div className="flex items-center gap-[18px] mb-[22px]">
      {/* View title */}
      <h1 className="text-[25px] font-extrabold tracking-[-0.4px] text-[var(--text)] shrink-0">
        {t(VIEW_TITLE_KEYS[activeTab])}
      </h1>

      {/* Segmented control (§9: one bubble element, never per-button bg) */}
      <div
        className="glass relative flex p-[4px] rounded-[13px] gap-[2px] ml-[6px]"
        role="group"
        aria-label={t('shell.seg.aria')}
      >
        {/* Sliding bubble — positioned behind the labels */}
        <span
          className="absolute top-[4px] bottom-[4px] rounded-[9px] pointer-events-none motion-safe:transition-transform motion-safe:duration-200"
          style={{
            width: `calc((100% - 8px - ${SEG_ITEMS.length - 1} * 2px) / ${SEG_ITEMS.length})`,
            transform: `translateX(calc(${activeIndex} * 100% + ${activeIndex} * 2px))`,
            background: 'var(--seg-bubble-bg)',
            boxShadow: 'var(--seg-bubble-shadow)'
          }}
          aria-hidden="true"
        />
        {SEG_ITEMS.map(({ id, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPlatform(id)}
            aria-pressed={platform === id}
            className={[
              'relative z-10 flex-1 text-[12.5px] font-semibold px-[13px] py-[6px] rounded-[9px]',
              'inline-flex items-center justify-center gap-[6px] border-0 bg-transparent cursor-pointer',
              'motion-safe:transition-colors',
              platform === id ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
            ].join(' ')}
          >
            {id === 'vrchat' && (
              <span className="font-extrabold" style={{ color: 'var(--vrc)' }} aria-hidden="true">
                V
              </span>
            )}
            {id === 'chilloutvr' && (
              <span className="font-extrabold" style={{ color: 'var(--cvr)' }} aria-hidden="true">
                C
              </span>
            )}
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
        {t('shell.onlineCount', { count: 0 })}
      </div>
    </div>
  )
}
