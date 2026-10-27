import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { Friend, Platform } from '@shared/types'
import { useAlertPicks, useSetAlertPicks } from '../queries/alertPicks'
import { friendsQueryKey } from '../queries/friends'
import LinkedDialog from './LinkedDialog'

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

const REMOVE_CLASS =
  'shrink-0 rounded-pill px-[var(--space-2)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:opacity-50'

function PlatformHeading({ platform }: { platform: Platform }): React.JSX.Element {
  const { t } = useTranslation()
  const isVrc = platform === 'vrchat'
  return (
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
  )
}

function PickRow({
  label,
  removeLabel,
  dim,
  disabled,
  onRemove
}: {
  label: string
  removeLabel: string
  dim: boolean
  disabled: boolean
  onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <li className="flex items-center justify-between gap-[var(--space-2)] py-[var(--space-1)]">
      <span
        className={
          dim ? 'min-w-0 text-[12.5px] text-[var(--text-dim)]' : 'min-w-0 truncate text-[13px]'
        }
        title={dim ? undefined : label}
      >
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={removeLabel}
        className={REMOVE_CLASS}
        onClick={onRemove}
      >
        {t('settings.notifications.picked.remove')}
      </button>
    </li>
  )
}

/** Observe the roster cache without a query observer, which could start a
 *  platform request just to show names. Undefined until a roster is known. */
function useCachedRoster(platform: Platform): readonly Friend[] | undefined {
  const queryClient = useQueryClient()
  return useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryData<Friend[]>(friendsQueryKey(platform))
  )
}

/** Split picks into roster names (sorted) and ids no longer in the roster. */
function namedPicks(
  picked: ReadonlySet<string>,
  roster: readonly Friend[]
): { known: { id: string; name: string }[]; missing: string[] } {
  const names = new Map(roster.map((friend) => [friend.platformUserId, friend.displayName]))
  const known: { id: string; name: string }[] = []
  const missing: string[] = []
  for (const id of picked) {
    const name = names.get(id)
    if (name === undefined) missing.push(id)
    else known.push({ id, name })
  }
  known.sort((a, b) => a.name.localeCompare(b.name))
  return { known, missing }
}

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
  const { accountId, picked, writable } = useAlertPicks(platform)
  const setPicks = useSetAlertPicks()
  const roster = useCachedRoster(platform)
  // A roster that has not loaded is not an empty one: never offer to remove
  // picks as "not in your friends list" before it is known.
  const { known, missing } = namedPicks(picked, roster ?? [])
  const disabled = busy || !writable

  const remove = async (ids: string[]): Promise<void> => {
    onBusy(true)
    const failure = await setPicks(platform, accountId, ids, false)
    onBusy(false)
    if (failure !== null) onFailure()
  }

  const emptyKey =
    accountId === null
      ? 'settings.notifications.picked.signedOut'
      : picked.size === 0
        ? 'settings.notifications.picked.none'
        : roster === undefined
          ? 'settings.notifications.picked.loading'
          : null

  return (
    <section className="flex flex-col gap-[var(--space-1)]" data-picked-platform={platform}>
      <PlatformHeading platform={platform} />
      {emptyKey !== null ? (
        <p className="text-[12.5px] text-[var(--text-dim)]">
          {t(emptyKey, { count: picked.size })}
        </p>
      ) : (
        <ul className="flex flex-col">
          {known.map(({ id, name }) => (
            <PickRow
              key={id}
              label={name}
              removeLabel={t('settings.notifications.picked.removeOne', { name })}
              dim={false}
              disabled={disabled}
              onRemove={() => void remove([id])}
            />
          ))}
          {missing.length > 0 && (
            <PickRow
              label={t('settings.notifications.picked.notInList', { count: missing.length })}
              removeLabel={t('settings.notifications.picked.removeMissing')}
              dim
              disabled={disabled}
              onRemove={() => void remove(missing)}
            />
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
