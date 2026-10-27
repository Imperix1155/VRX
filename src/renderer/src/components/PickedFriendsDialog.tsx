import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { Friend, Platform } from '@shared/types'
import { useAlertPicks, useSetAlertPicks } from '../queries/alertPicks'
import { friendsQueryKey } from '../queries/friends'
import LinkedDialog from './LinkedDialog'

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

const REMOVE_CLASS =
  'shrink-0 rounded-pill px-[var(--space-2)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:opacity-50'

function PlatformPicks({
  platform,
  busy,
  onBusy,
  onFailure
}: {
  platform: Platform
  busy: boolean
  onBusy: (busy: boolean) => void
  onFailure: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { accountId, picked, writable } = useAlertPicks(platform)
  const setPicks = useSetAlertPicks()
  const isVrc = platform === 'vrchat'
  // Read the roster already in memory. Observing it here could start a
  // platform request just to show names.
  const roster = queryClient.getQueryData<Friend[]>(friendsQueryKey(platform)) ?? []
  const names = new Map(roster.map((friend) => [friend.platformUserId, friend.displayName]))
  const known = [...picked]
    .filter((id) => names.has(id))
    .map((id) => ({ id, name: names.get(id) ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const missing = [...picked].filter((id) => !names.has(id))

  const remove = async (ids: string[]): Promise<void> => {
    onBusy(true)
    const failure = await setPicks(platform, accountId, ids, false)
    onBusy(false)
    if (failure !== null) onFailure()
  }

  return (
    <section className="flex flex-col gap-[var(--space-1)]" data-picked-platform={platform}>
      <h3>
        <span
          className="inline-flex h-[22px] items-center rounded-[9px] border bg-transparent px-[var(--space-2)] text-[11px] font-semibold"
          style={{
            color: isVrc ? 'var(--plat-vrc-ghost-text)' : 'var(--plat-cvr-ghost-text)',
            borderColor: isVrc ? 'var(--plat-vrc-ghost-border)' : 'var(--plat-cvr-ghost-border)'
          }}
        >
          {t(isVrc ? 'friends.platform.vrchat' : 'friends.platform.chilloutvr')}
        </span>
      </h3>
      {accountId === null ? (
        <p className="text-[12.5px] text-[var(--text-dim)]">
          {t('settings.notifications.picked.signedOut')}
        </p>
      ) : known.length === 0 && missing.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-dim)]">
          {t('settings.notifications.picked.none')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {known.map(({ id, name }) => (
            <li
              key={id}
              className="flex items-center justify-between gap-[var(--space-2)] py-[var(--space-1)]"
            >
              <span className="min-w-0 truncate text-[13px]" title={name}>
                {name}
              </span>
              <button
                type="button"
                disabled={busy || !writable}
                aria-label={t('settings.notifications.picked.removeOne', { name })}
                className={REMOVE_CLASS}
                onClick={() => void remove([id])}
              >
                {t('settings.notifications.picked.remove')}
              </button>
            </li>
          ))}
          {missing.length > 0 && (
            <li className="flex items-center justify-between gap-[var(--space-2)] py-[var(--space-1)]">
              <span className="min-w-0 text-[12.5px] text-[var(--text-dim)]">
                {t('settings.notifications.picked.notInList', { count: missing.length })}
              </span>
              <button
                type="button"
                disabled={busy || !writable}
                aria-label={t('settings.notifications.picked.removeMissing')}
                className={REMOVE_CLASS}
                onClick={() => void remove(missing)}
              >
                {t('settings.notifications.picked.remove')}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

/** Every picked friend, VRChat then ChilloutVR, with a Remove for each. */
export default function PickedFriendsDialog({
  onClose
}: {
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <LinkedDialog title={t('settings.notifications.picked.title')} busy={busy} onClose={onClose}>
      <div className="flex flex-col gap-[var(--space-3)]">
        {PLATFORMS.map((platform) => (
          <PlatformPicks
            key={platform}
            platform={platform}
            busy={busy}
            onBusy={(next) => {
              if (next) setFailed(false)
              setBusy(next)
            }}
            onFailure={() => setFailed(true)}
          />
        ))}
        <p role="status" className="min-h-[16px] text-[12px] text-[var(--text-dim)]">
          {failed ? t('drawer.alerts.saveFailed') : ''}
        </p>
      </div>
    </LinkedDialog>
  )
}
