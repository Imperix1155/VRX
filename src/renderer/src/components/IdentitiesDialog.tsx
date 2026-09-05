import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Friend, Platform } from '@shared/types'
import type {
  FriendRef,
  LinkedProfile,
  LinkRequest,
  LinkResult,
  LinkSnapshot
} from '@shared/linkedProfiles'
import {
  changeLinkedProfile,
  linkedProfilesKey,
  useLinkedProfiles
} from '../queries/linkedProfiles'
import type { ProfileTarget, ResolvedProfile } from '../utils/projectLinkedFriends'
import { splitByMatch } from '../utils/splitByMatch'
import { Avatar } from './Avatar'
import PlatformPill from './PlatformPill'
import LinkedDialog from './LinkedDialog'
import LinkConfirmDialog, { type LinkReview } from './LinkConfirmDialog'

type Identity = { ref: FriendRef & { platformAccountId?: string }; name: string }
type Flow =
  | { kind: 'identities' }
  | { kind: 'picker'; source: FriendRef }
  | { kind: 'review'; review: LinkReview; identities: Identity[] }
  | { kind: 'already'; personId: string; anchor: FriendRef }
const buttonClass =
  'rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50'
const inputClass =
  'w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-2-5)] py-[var(--space-2)] text-[13px] text-[var(--text)]'
const failureKeys = {
  invalid: 'linking.manage.invalid',
  stale: 'linking.manage.stale',
  unavailable: 'linking.manage.unavailable',
  storage: 'linking.manage.failed',
  'rate-limited': 'linking.manage.rateLimited'
} as const

export default function IdentitiesDialog({
  selection,
  friends,
  accountIds,
  available,
  onClose,
  onNavigate
}: {
  selection: ResolvedProfile
  friends: Friend[]
  accountIds: Partial<Record<Platform, string>>
  available?: Partial<Record<Platform, boolean>>
  onClose: () => void
  onNavigate: (target: ProfileTarget) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const client = useQueryClient()
  const query = useLinkedProfiles()
  const snapshot = query.data
  const [lease] = useState(snapshot?.lease ?? '')
  const [flow, setFlow] = useState<Flow>({ kind: 'identities' })
  const [search, setSearch] = useState('')
  const [customName, setCustomName] = useState(selection.profile?.customName ?? selection.name)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const profile = snapshot?.profiles.find((person) => person.id === selection.profile?.id) ?? null
  const origin =
    selection.target.kind === 'person' ? selection.target.anchor : selection.target.account
  const canWrite =
    !!lease &&
    snapshot?.lease === lease &&
    !query.isError &&
    typeof window.vrx?.changeLinkedProfile === 'function'
  const bothReady =
    !!accountIds.vrchat &&
    !!accountIds.chilloutvr &&
    available?.vrchat !== false &&
    available?.chilloutvr !== false
  const findFriend = (ref: FriendRef): Friend | undefined =>
    available?.[ref.platform] === false
      ? undefined
      : friends.find(
          (friend) => friend.platform === ref.platform && friend.platformUserId === ref.friendId
        )

  useEffect(() => {
    if (snapshot !== undefined && snapshot.lease !== lease) onClose()
  }, [snapshot, lease, onClose])
  useEffect(() => window.vrx?.onIdentityBoundary?.(onClose), [onClose])

  async function submit(change: LinkRequest): Promise<LinkResult<LinkSnapshot>> {
    if (pending.current || !canWrite) return { ok: false, reason: 'unavailable' }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await changeLinkedProfile(client, lease, change)
      if (!result.ok) {
        setError(failureKeys[result.reason])
        if (result.reason === 'stale')
          void client.invalidateQueries({ queryKey: linkedProfilesKey })
      }
      return result
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  async function update(patch: Extract<LinkRequest, { kind: 'update' }>['patch']): Promise<void> {
    if (profile === null) return
    await submit({
      kind: 'update',
      personId: profile.id,
      expectedRevision: profile.revision,
      patch
    })
  }
  function openAccount(ref: FriendRef): void {
    onNavigate({
      kind: 'account',
      personId: profile?.id ?? null,
      account: { platform: ref.platform, friendId: ref.friendId }
    })
    onClose()
  }
  function startPicker(source: FriendRef): void {
    if (!bothReady || !canWrite || findFriend(source) === undefined) return
    setSearch('')
    setError(null)
    setFlow({ kind: 'picker', source: { platform: source.platform, friendId: source.friendId } })
  }
  function labels(affected: LinkedProfile[]): Identity[] {
    return [
      ...friends.map((friend) => ({
        ref: { platform: friend.platform, friendId: friend.platformUserId },
        name: friend.displayName
      })),
      ...affected.flatMap((person) =>
        person.members.map((member) => ({
          ref: member,
          name:
            accountIds[member.platform] === member.platformAccountId
              ? (findFriend(member)?.displayName ?? t('linking.unavailable'))
              : t('linking.unavailable')
        }))
      )
    ]
  }
  function choose(source: FriendRef, other: Friend): void {
    if (!canWrite || !bothReady) return
    const members: [FriendRef, FriendRef] = [
      source,
      { platform: other.platform, friendId: other.platformUserId }
    ]
    const affected = (snapshot?.profiles ?? []).filter((person) =>
      person.members.some((member) =>
        members.some(
          (ref) =>
            ref.platform === member.platform &&
            ref.friendId === member.friendId &&
            accountIds[member.platform] === member.platformAccountId
        )
      )
    )
    if (
      affected.length === 1 &&
      affected[0]!.members.every((member) =>
        members.some(
          (ref) =>
            ref.platform === member.platform &&
            ref.friendId === member.friendId &&
            accountIds[member.platform] === member.platformAccountId
        )
      )
    ) {
      setFlow({ kind: 'already', personId: affected[0]!.id, anchor: source })
      return
    }
    setFlow({
      kind: 'review',
      review: structuredClone({
        kind: 'replace',
        members,
        preferredPlatform: source.platform,
        affected,
        accountIds: { vrchat: accountIds.vrchat!, chilloutvr: accountIds.chilloutvr! }
      }),
      identities: labels(affected)
    })
  }
  function success(next: LinkSnapshot): void {
    const source =
      flow.kind === 'review' && flow.review.kind === 'replace' ? flow.review.members[0] : origin
    const nextProfile = next.profiles.find((person) =>
      person.members.some(
        (member) =>
          member.platform === source.platform &&
          member.friendId === source.friendId &&
          member.platformAccountId === accountIds[member.platform]
      )
    )
    onNavigate(
      nextProfile
        ? { kind: 'person', personId: nextProfile.id, anchor: source }
        : { kind: 'account', personId: null, account: source }
    )
    onClose()
  }
  const displayedMembers = profile?.members ?? [origin]
  const platformName = (platform: Platform): string =>
    t(platform === 'vrchat' ? 'friends.platform.vrchat' : 'friends.platform.chilloutvr')
  const title =
    flow.kind === 'picker'
      ? t('linking.manage.link')
      : flow.kind === 'already'
        ? t('linking.manage.already')
        : flow.kind === 'review'
          ? t(
              flow.review.kind === 'unlink'
                ? 'linking.manage.unlinkTitle'
                : 'linking.manage.linkTitle'
            )
          : t('linking.identities')

  return (
    <LinkedDialog title={title} busy={busy} onClose={onClose}>
      {flow.kind === 'review' ? (
        <LinkConfirmDialog
          review={flow.review}
          identities={flow.identities}
          onSubmit={submit}
          onClose={onClose}
          onBack={() => {
            setError(null)
            setFlow({ kind: 'identities' })
          }}
          onSuccess={success}
        />
      ) : (
        <>
          {flow.kind === 'already' ? (
            <div className="flex flex-col gap-[var(--space-3)]">
              <p className="text-[13px]">{t('linking.manage.alreadyDescription')}</p>
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  onNavigate({ kind: 'person', personId: flow.personId, anchor: flow.anchor })
                  onClose()
                }}
              >
                {t('linking.manage.viewCombined')}
              </button>
            </div>
          ) : flow.kind === 'picker' ? (
            <div className="flex flex-col gap-[var(--space-3)]">
              <p className="text-[13px]">
                {t('linking.manage.choose', {
                  platform: platformName(
                    flow.source.platform === 'vrchat' ? 'chilloutvr' : 'vrchat'
                  )
                })}
              </p>
              <label className="text-[12px] text-[var(--text-dim)]">
                {t('friends.searchPlaceholder')}
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={inputClass}
                />
              </label>
              <ul
                aria-label={t('friends.title')}
                className="flex max-h-[45vh] flex-col gap-[var(--space-2)] overflow-y-auto"
              >
                {friends
                  .filter(
                    (friend) =>
                      friend.platform !== flow.source.platform &&
                      (!search.trim() ||
                        splitByMatch(friend.displayName, search.trim()).some(
                          (part) => part.isMatch
                        ))
                  )
                  .map((friend) => (
                    <li key={`${friend.platform}:${friend.platformUserId}`}>
                      <button
                        type="button"
                        className={`${buttonClass} flex w-full items-center gap-[var(--space-2)] text-left`}
                        disabled={!bothReady || !canWrite}
                        onClick={() => choose(flow.source, friend)}
                      >
                        <Avatar friend={friend} variant="row" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{friend.displayName}</span>
                          {snapshot?.profiles.some((person) =>
                            person.members.some(
                              (member) =>
                                member.platform === friend.platform &&
                                member.friendId === friend.platformUserId &&
                                member.platformAccountId === accountIds[member.platform]
                            )
                          ) && (
                            <span className="block text-[11px] text-[var(--text-dim)]">
                              {t('linking.manage.linkedCandidate')}
                            </span>
                          )}
                        </span>
                        <PlatformPill platform={friend.platform} />
                      </button>
                    </li>
                  ))}
              </ul>
              {!friends.some(
                (friend) =>
                  friend.platform !== flow.source.platform &&
                  (!search.trim() ||
                    splitByMatch(friend.displayName, search.trim()).some((part) => part.isMatch))
              ) && (
                <p className="text-[13px] text-[var(--text-dim)]">
                  {t('linking.manage.noMatches')}
                </p>
              )}
              <button
                type="button"
                className={buttonClass}
                onClick={() => setFlow({ kind: 'identities' })}
              >
                {t('linking.manage.back')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-[var(--space-3)]">
              {!profile && (
                <p className="text-[13px] text-[var(--text-dim)]">{t('linking.manage.intro')}</p>
              )}
              {displayedMembers.map((member) => {
                const scoped =
                  !('platformAccountId' in member) ||
                  member.platformAccountId === accountIds[member.platform]
                const friend = scoped ? findFriend(member) : undefined
                return (
                  <div
                    key={member.platform}
                    className="flex flex-col gap-[var(--space-2)] rounded-[12px] border border-[var(--border)] p-[var(--space-3)]"
                  >
                    <div className="flex items-center gap-[var(--space-2-5)]">
                      {friend && <Avatar friend={friend} variant="row" />}
                      <strong className="min-w-0 flex-1 break-words text-[14px]">
                        {friend?.displayName ?? t('linking.unavailable')}
                      </strong>
                      <PlatformPill platform={member.platform} />
                    </div>
                    {!friend && (
                      <p className="text-[12px] text-[var(--text-dim)]">
                        {t('linking.manage.stillLinked')}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-[var(--space-2)]">
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={!friend || busy}
                        onClick={() => openAccount(member)}
                      >
                        {t('linking.manage.view', { platform: platformName(member.platform) })}
                      </button>
                      {profile && (
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={!bothReady || !canWrite || busy}
                          onClick={() => {
                            const keep = profile.members.find(
                              (other) => other.platform !== member.platform
                            )
                            if (keep) startPicker(keep)
                          }}
                        >
                          {t('linking.manage.replace')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {profile && (
                <>
                  <label className="text-[12px] text-[var(--text-dim)]">
                    {t('linking.manage.name')}
                    <input
                      type="text"
                      maxLength={256}
                      className={inputClass}
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                    />
                  </label>
                  <div className="flex gap-[var(--space-2)]">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={!canWrite || busy || !customName.trim()}
                      onClick={() => void update({ customName: customName.trim() })}
                    >
                      {t('linking.manage.saveName')}
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={!canWrite || busy}
                      onClick={() => {
                        const preferred = profile.members.find(
                          (member) => member.platform === profile.preferredPlatform
                        )!
                        const defaultName =
                          preferred.platformAccountId === accountIds[preferred.platform]
                            ? (findFriend(preferred)?.displayName ?? profile.defaultName)
                            : profile.defaultName
                        setCustomName(defaultName)
                        void update({ customName: null, defaultName })
                      }}
                    >
                      {t('linking.manage.platformName')}
                    </button>
                  </div>
                  <p className="text-[12px] text-[var(--text-dim)]">
                    {t('linking.manage.localName')}
                  </p>
                  <label className="text-[12px] text-[var(--text-dim)]">
                    {t('linking.manage.preferred')}
                    <select
                      className={inputClass}
                      value={profile.preferredPlatform}
                      disabled={!canWrite || busy}
                      onChange={(event) => {
                        const preferredPlatform = event.target.value as Platform
                        const preferred = profile.members.find(
                          (member) => member.platform === preferredPlatform
                        )!
                        const defaultName =
                          preferred.platformAccountId === accountIds[preferred.platform]
                            ? (findFriend(preferred)?.displayName ?? profile.defaultName)
                            : profile.defaultName
                        void update({ preferredPlatform, defaultName })
                      }}
                    >
                      <option value="vrchat">{platformName('vrchat')}</option>
                      <option value="chilloutvr">{platformName('chilloutvr')}</option>
                    </select>
                  </label>
                  <p className="text-[12px] text-[var(--text-dim)]">{t('linking.manage.tie')}</p>
                  <label className="flex items-start gap-[var(--space-2)] text-[12px]">
                    <input
                      type="checkbox"
                      checked={profile.pictureMode === 'merged'}
                      disabled={!canWrite || busy}
                      onChange={(event) =>
                        void update({ pictureMode: event.target.checked ? 'merged' : 'preferred' })
                      }
                    />
                    {t('linking.manage.merged')}
                  </label>
                </>
              )}
              <div className="flex flex-wrap justify-end gap-[var(--space-2)]">
                {profile ? (
                  <button
                    type="button"
                    className={`${buttonClass} text-[var(--error)]`}
                    disabled={!canWrite || busy}
                    onClick={() =>
                      setFlow({
                        kind: 'review',
                        review: structuredClone({ kind: 'unlink', profile }),
                        identities: labels([profile])
                      })
                    }
                  >
                    {t('linking.manage.unlink')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={!bothReady || !canWrite || busy}
                    title={!bothReady ? t('linking.manage.unavailable') : undefined}
                    onClick={() => startPicker(origin)}
                  >
                    {t('linking.manage.link')}
                  </button>
                )}
                <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
                  {t('linking.manage.done')}
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-[var(--space-3)] text-[13px] text-[var(--error)]">
              {t(error)}
            </p>
          )}
        </>
      )}
    </LinkedDialog>
  )
}
