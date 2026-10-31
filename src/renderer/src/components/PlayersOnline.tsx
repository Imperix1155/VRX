/**
 * The Dashboard's "Playing now" line (owner, 2026-10-31): how many people are
 * online on each platform, as the platform itself reports it. Read when the
 * Dashboard opens and reused for 5 minutes; never on a timer. Each count sits
 * beside its platform's name, so the color dot is never the only cue. A
 * platform that isn't signed in or didn't answer simply drops out of the line.
 */
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { usePlayersOnline } from '../queries/community'
import { platformName } from '../utils/community'

export default function PlayersOnline({
  platforms
}: {
  platforms: readonly Platform[]
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const vrc = usePlayersOnline('vrchat', platforms.includes('vrchat'))
  const cvr = usePlayersOnline('chilloutvr', platforms.includes('chilloutvr'))
  const counts = (
    [
      ['vrchat', vrc.data],
      ['chilloutvr', cvr.data]
    ] as const
  ).flatMap(([platform, result]) =>
    platforms.includes(platform) && result?.ok ? [{ platform, count: result.count }] : []
  )
  if (counts.length === 0) return null
  const format = new Intl.NumberFormat(i18n.language)
  return (
    <p
      data-players-online=""
      className="canvas-text mt-[var(--space-3)] flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-[var(--space-1)] text-[12.5px] text-[var(--text-dim)]"
    >
      <span>{t('dashboard.playersOnline.label')}</span>
      {counts.map(({ platform, count }) => (
        <span key={platform} className="inline-flex items-center gap-[var(--space-1)]">
          <span
            aria-hidden="true"
            className="inline-block h-[7px] w-[7px] rounded-full"
            style={{ background: platform === 'vrchat' ? 'var(--vrc)' : 'var(--cvr)' }}
          />
          <span>{platformName(t, platform)}</span>
          <span className="font-semibold tabular-nums text-[var(--text)]">
            {format.format(count)}
          </span>
        </span>
      ))}
      <span
        className="cursor-help rounded-full border px-[6px] text-[10.5px] font-semibold leading-[16px]"
        style={{ borderColor: 'var(--border)' }}
        title={t('dashboard.playersOnline.help')}
        aria-label={t('dashboard.playersOnline.help')}
        role="img"
      >
        ?
      </span>
    </p>
  )
}
