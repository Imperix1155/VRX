import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { isFriendJoinable } from '@shared/joinability'
import type { Friend } from '@shared/types'
import { useJoinInstance } from '../hooks/useJoinInstance'
import { useSettingsStore } from '../stores/settings'
import { instancePillFor } from '../utils/instancePill'
import { policySpaceFor } from '../utils/instancePolicySpace'
import InstancePill from './InstancePill'
import LinkedDialog from './LinkedDialog'
import PolicySpacePill from './PolicySpacePill'

interface ReviewedDestination {
  friend: Friend
  worldId: string
  instanceId: string
}

const PLATFORM_KEY = {
  vrchat: 'friends.platform.vrchat',
  chilloutvr: 'friends.platform.chilloutvr'
} as const

function captureDestinations(accounts: Friend[]): ReviewedDestination[] {
  return accounts.flatMap((friend) => {
    if (!isFriendJoinable(friend) || friend.instance === null) return []
    return [
      {
        friend: structuredClone(friend),
        worldId: friend.instance.worldId,
        instanceId: friend.instance.instanceId
      }
    ]
  })
}

function currentDestination(accounts: Friend[], reviewed: ReviewedDestination): Friend | null {
  const current = accounts.find(
    (friend) =>
      friend.platform === reviewed.friend.platform &&
      friend.platformUserId === reviewed.friend.platformUserId
  )
  if (!current || !isFriendJoinable(current) || current.instance === null) return null
  return current.instance.worldId === reviewed.worldId &&
    current.instance.instanceId === reviewed.instanceId
    ? current
    : null
}

export default function LinkedDestinationChooser({
  accounts,
  onClose
}: {
  accounts: Friend[]
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const reviewed = useState(() => captureDestinations(accounts))[0]
  const hadAccounts = useRef(accounts.length > 0)
  const invalidatedRef = useRef(false)
  const [invalidated, setInvalidated] = useState<string | null>(null)
  const [expiredChoices, setExpiredChoices] = useState<string[]>([])
  const newlyExpired = reviewed
    .filter((destination) => currentDestination(accounts, destination) === null)
    .map((destination) => destination.friend.platform)
    .filter((platform) => !expiredChoices.includes(platform))
  if (newlyExpired.length > 0) setExpiredChoices([...expiredChoices, ...newlyExpired])
  const { join, isJoining, pendingConfirm } = useJoinInstance()
  const { allowJoinInstances, labelScheme } = useSettingsStore((state) => state.settings)
  const busy = isJoining || pendingConfirm !== null
  const disabled = busy || !allowJoinInstances

  useEffect(() => {
    if (hadAccounts.current && accounts.length === 0) onClose()
  }, [accounts.length, onClose])
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.vrx?.onIdentityBoundary !== 'function')
      return
    return window.vrx.onIdentityBoundary(() => {
      invalidatedRef.current = true
      onClose()
    })
  }, [onClose])

  return (
    <LinkedDialog title={t('linking.chooseDestination')} busy={busy} onClose={onClose}>
      <div className="space-y-[var(--space-3)]">
        {reviewed.length === 0 ? (
          <p className="text-sm text-[var(--text-dim)]">{t('linking.chooser.none')}</p>
        ) : null}
        {reviewed.map((destination) => {
          const current = currentDestination(accounts, destination)
          const unavailable =
            current === null || expiredChoices.includes(destination.friend.platform)
          const pill = instancePillFor(destination.friend.instance!, labelScheme)
          return (
            <article
              key={`${destination.friend.platform}:${destination.friend.platformUserId}`}
              className="rounded-control border border-[color-mix(in_srgb,var(--border)_36%,transparent)] p-[var(--space-3)]"
            >
              <div className="flex items-center justify-between gap-[var(--space-2)]">
                <span className="text-sm font-semibold">
                  {t(PLATFORM_KEY[destination.friend.platform])}
                </span>
                <InstancePill label={t(pill.labelKey)} tier={pill.tier} />
              </div>
              <p className="mt-[var(--space-2)] truncate text-sm">
                {destination.friend.instance!.worldName ?? t('friends.instance.unknownWorld')}
              </p>
              <div className="mt-[var(--space-2)]">
                <PolicySpacePill
                  space={policySpaceFor(destination.friend.platform, destination.friend.instance!)}
                />
              </div>
              {unavailable ||
              invalidated === destination.friend.platform + destination.friend.platformUserId ? (
                <p className="mt-[var(--space-2)] text-xs text-[var(--text-dim)]">
                  {t('linking.activityChanged')}
                </p>
              ) : null}
              <button
                type="button"
                className="mt-[var(--space-3)] rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-sm disabled:opacity-50"
                disabled={disabled || unavailable}
                onClick={() => {
                  const live =
                    invalidatedRef.current || expiredChoices.includes(destination.friend.platform)
                      ? null
                      : currentDestination(accounts, destination)
                  if (live === null) {
                    setInvalidated(destination.friend.platform + destination.friend.platformUserId)
                    return
                  }
                  flushSync(onClose)
                  void join(destination.friend)
                }}
              >
                {t('linking.joinOn', {
                  platform: t(PLATFORM_KEY[destination.friend.platform])
                })}
              </button>
            </article>
          )
        })}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-sm text-[var(--text-dim)]"
        >
          {t('linking.cancel')}
        </button>
      </div>
    </LinkedDialog>
  )
}
