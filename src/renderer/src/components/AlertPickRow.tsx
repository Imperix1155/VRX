import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, Platform } from '@shared/types'
import { useAlertPicks, useSetAlertPicks } from '../queries/alertPicks'
import Toggle from './Toggle'

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/**
 * "Alert me about this friend" in the friend details bell panel
 * (FriendAlertBell). Shown only while Settings → Notifications limits alerts
 * to picked friends. A linked person
 * is one pick across every account shown, so both platforms move together.
 * It reads On while any shown account can still alert, so Off always stops
 * every one of them.
 */
export default function AlertPickRow({
  accounts,
  name
}: {
  accounts: readonly Friend[]
  name: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const vrchat = useAlertPicks('vrchat')
  const chilloutvr = useAlertPicks('chilloutvr')
  const setPicks = useSetAlertPicks()
  const [failure, setFailure] = useState<{ owner: string; key: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const picks = { vrchat, chilloutvr }
  const owner = accounts.map((a) => `${a.platform}:${a.platformUserId}`).join('|')

  if (accounts.length === 0) return null
  const picked = accounts.some((a) => picks[a.platform].picked.has(a.platformUserId))
  const writable = accounts.every((a) => picks[a.platform].writable)
  const shownFailure = failure?.owner === owner ? failure.key : null

  const onChange = async (next: boolean): Promise<void> => {
    setFailure(null)
    setSaving(true)
    let reason: string | null = null
    for (const platform of PLATFORMS) {
      const ids = accounts.filter((a) => a.platform === platform).map((a) => a.platformUserId)
      if (ids.length === 0) continue
      reason ??= await setPicks(platform, picks[platform].accountId, ids, next)
    }
    setSaving(false)
    if (reason !== null) {
      setFailure({
        owner,
        key: reason === 'full' ? 'drawer.alerts.full' : 'drawer.alerts.saveFailed'
      })
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <div
        data-alert-pick
        className="flex items-center justify-between gap-[var(--space-3)] rounded-control border bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)]"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="min-w-0 text-[13px] text-[var(--text)]">{t('drawer.alerts.label')}</p>
        <Toggle
          checked={picked}
          disabled={!writable || saving}
          ariaLabel={t('drawer.alerts.aria', { name })}
          onChange={(next) => void onChange(next)}
        />
      </div>
      {shownFailure && (
        <p role="alert" className="text-[12px] text-[var(--text-dim)]">
          {t(shownFailure)}
        </p>
      )}
    </div>
  )
}
