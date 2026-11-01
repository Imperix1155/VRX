/**
 * The top bar's counts (owner, 2026-11-01): "13 friends" with the connection
 * dot, and under it how many people play each platform right now ("VRC 48,213
 * CVR 1,876"). Both follow the platform filter. Hovering or focusing the block
 * opens a small panel that spells everything out.
 *
 * Player counts are read when VRX opens and again on a page switch once the
 * last answer is 5 minutes old; never on a timer, window focus or reconnect
 * (docs/api-policy.md). A platform that isn't signed in or didn't answer drops
 * out. Each number sits beside its platform's word, so color is never the only
 * cue (DESIGN.md §2).
 */
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import type { PlayerCount } from '../hooks/usePlayerCounts'
import { platformName } from '../utils/community'

const WORD: Record<Platform, { key: string; color: string }> = {
  vrchat: { key: 'shell.seg.vrchatShort', color: 'var(--plat-vrc-word)' },
  chilloutvr: { key: 'shell.seg.chilloutvrShort', color: 'var(--plat-cvr-word)' }
}

export default function TopBarCounts({
  status,
  dot,
  onlineCount,
  connectionLabel,
  counts
}: {
  /** The friend count line with its connection dot (TopBar's status). */
  status: React.ReactNode
  /** A still copy of the connection dot for the panel. */
  dot: React.ReactNode
  onlineCount: number
  connectionLabel: string
  counts: readonly PlayerCount[]
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const format = new Intl.NumberFormat(i18n.language)

  return (
    <div
      data-testid="topbar-counts"
      className="relative flex shrink-0 cursor-default flex-col items-end gap-[3px] rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]"
      tabIndex={0}
      aria-label={t('shell.counts.aria')}
      aria-describedby={panelId}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      {status}
      {counts.length > 0 ? (
        <div
          data-testid="topbar-player-counts"
          className="canvas-text flex items-baseline gap-[10px] whitespace-nowrap text-[12px] tabular-nums"
        >
          {counts.map(({ platform, count }) => (
            <span key={platform} className="inline-flex items-baseline gap-[5px]">
              <span
                className="text-[11px] font-bold uppercase tracking-wide"
                style={{ color: WORD[platform].color }}
              >
                {t(WORD[platform].key)}
              </span>
              <span className="font-semibold text-[var(--text)]">{format.format(count)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Stays in the tree while closed so the block's description is
          always there for screen readers. */}
      <div
        id={panelId}
        role="tooltip"
        className={[
          'glass glass-information absolute right-0 top-full z-50 mt-[10px] w-[272px] p-[12px_14px] text-left text-[12.5px] leading-[1.45]',
          open ? 'block' : 'hidden'
        ].join(' ')}
      >
        <div className="flex items-center gap-[8px] text-[var(--text)]">
          {dot}
          <span>{t('shell.counts.friendsOnline', { count: onlineCount })}</span>
        </div>
        <div className="mt-[2px] pl-[16px] text-[11.5px] text-[var(--text-dim)]">
          {connectionLabel}
        </div>
        {counts.length > 0 ? (
          <>
            <div aria-hidden="true" className="my-[10px] h-px bg-[var(--border)]" />
            <div className="text-[var(--text-dim)]">{t('shell.counts.playingNow')}</div>
            {counts.map(({ platform, count }) => (
              <div key={platform} className="mt-[4px] flex items-baseline gap-[8px] tabular-nums">
                <span
                  aria-hidden="true"
                  className="w-[30px] text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: WORD[platform].color }}
                >
                  {t(WORD[platform].key)}
                </span>
                <span className="text-[var(--text-dim)]">{platformName(t, platform)}</span>
                <span className="ml-auto font-semibold text-[var(--text)]">
                  {format.format(count)}
                </span>
              </div>
            ))}
            <div className="mt-[8px] text-[11.5px] text-[var(--text-dim)]">
              {t('shell.counts.note')}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
