/**
 * The Dashboard's condensed glance row (owner, 2026-10-27), under the numbers:
 * "Wearing now" (the avatar worn on each signed-in platform) and "Latest
 * invites" (the newest invite or invite request from each platform). Both
 * follow the platform filter, use one row shape for VRChat and ChilloutVR with
 * the platform as a word, and can be hidden in Settings → Dashboard.
 *
 * Nothing here polls. The worn avatar comes from `useWornAvatar` (the Avatars
 * page's data when fresh, else one request per platform); invites come from
 * the socket-fed inbox that is already in memory.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarItem, AvatarLibraryFailure } from '@shared/avatarLibrary'
import type { Friend, Platform } from '@shared/types'
import { useWornAvatar, type WornAvatarState } from '../queries/currentAvatar'
import { useAvatarAccount } from '../queries/avatarLibrary'
import { useInbox } from '../queries/inbox'
import { useFriends } from '../queries/friends'
import { useAvatar } from '../hooks/useAvatar'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { inboxActionText, latestInvitePerPlatform, relativeInboxTime } from '../utils/inbox'
import { InboxAvatar } from './InboxView'
import PlatformPill from './PlatformPill'

/** Ages refresh once a minute while the section shows; no data is read. */
const AGE_TICK_MS = 60_000

const ERROR_KEYS: Record<AvatarLibraryFailure, string> = {
  unavailable: 'avatars.error.unavailable',
  'rate-limited': 'avatars.error.rate-limited',
  'not-authenticated': 'avatars.error.not-authenticated'
}
/** Quoted literals keep the locale parity scan aware of these key families. */
const NO_CURRENT_KEYS: Record<Platform, string> = {
  vrchat: 'avatars.noCurrent.vrchat',
  chilloutvr: 'avatars.noCurrent.chilloutvr'
}

/** One row height for both sections and every state, so the two lists line up. */
const ROW =
  'flex min-h-[76px] w-full min-w-0 items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)]'
const ROW_BUTTON = `${ROW} text-left hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors`
const HEADER_BUTTON =
  'rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]'

function platformName(platform: Platform, t: (key: string) => string): string {
  return t(platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
}

export default function DashboardGlance({
  platforms
}: {
  /** The platforms in the global filter's scope. */
  platforms: readonly Platform[]
}): React.JSX.Element | null {
  const showWorn = useSettingsStore((s) => s.settings.dashboardWearingNow)
  const showInvites = useSettingsStore((s) => s.settings.dashboardInvites)
  const vrcAccount = useAvatarAccount('vrchat')
  const cvrAccount = useAvatarAccount('chilloutvr')
  const signedIn = platforms.filter(
    (platform) => (platform === 'vrchat' ? vrcAccount : cvrAccount) !== null
  )
  const wornShown = showWorn && signedIn.length > 0
  const vrcWorn = useWornAvatar('vrchat', wornShown && signedIn.includes('vrchat'))
  const cvrWorn = useWornAvatar('chilloutvr', wornShown && signedIn.includes('chilloutvr'))

  if (!wornShown && !showInvites) return null
  return (
    <div className="glancewrap">
      <div className="glance-grid">
        {wornShown ? (
          <WornAvatars
            rows={signedIn.map((platform) => ({
              platform,
              state: platform === 'vrchat' ? vrcWorn : cvrWorn
            }))}
          />
        ) : null}
        {showInvites ? <LatestInvites platforms={platforms} /> : null}
      </div>
    </div>
  )
}

function GlanceHeading({
  id,
  label,
  action
}: {
  id: string
  label: string
  action: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mx-[2px] mb-[10px] flex min-h-[28px] items-center justify-between gap-[var(--space-3)]">
      <h2
        id={id}
        className="truncate font-[family-name:var(--font-mono)] text-[18px] font-normal tracking-[2px] uppercase text-[var(--text-faint)]"
      >
        {label}
      </h2>
      {action}
    </div>
  )
}

// ─── Wearing now ──────────────────────────────────────────────────────────────

function WornAvatars({
  rows
}: {
  rows: { platform: Platform; state: WornAvatarState }[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const openAvatars = (): void => useUiStore.getState().setActiveTab('avatars')
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <GlanceHeading
        id={headingId}
        label={t('avatars.wearingNow')}
        action={
          <button
            type="button"
            onClick={openAvatars}
            aria-label={t('dashboard.glance.openAvatarsAria')}
            className={HEADER_BUTTON}
          >
            {t('shell.nav.avatars')}
          </button>
        }
      />
      <ul className="glass glass-information divide-y divide-[var(--border)] overflow-hidden">
        {rows.map(({ platform, state }) => (
          <li key={platform}>
            <WornRow platform={platform} state={state} onOpen={openAvatars} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function WornRow({
  platform,
  state,
  onOpen
}: {
  platform: Platform
  state: WornAvatarState
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = platformName(platform, t)
  const result = state.result
  if (result?.ok === true && result.current !== null) {
    return <WornAvatarButton avatar={result.current} onOpen={onOpen} />
  }

  let text: string
  let tone = 'text-[var(--text-dim)]'
  let retry = false
  if (result === undefined && !state.isError) {
    text = t('avatars.loadingPlatform', { platform: name })
  } else if (result?.ok === true) {
    text = t(NO_CURRENT_KEYS[platform])
  } else {
    text = t(ERROR_KEYS[result?.ok === false ? result.reason : 'unavailable'], { platform: name })
    tone = 'text-[var(--error)]'
    retry = true
  }
  return (
    <div className={ROW} role={retry ? 'alert' : 'status'}>
      <WornPicture url={null} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-[var(--space-1)]">
        <p className={`text-sm ${tone}`}>{text}</p>
        <PlatformPill platform={platform} />
      </div>
      {retry ? (
        <button
          type="button"
          onClick={state.refetch}
          className="shrink-0 rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('avatars.retry')}
        </button>
      ) : null}
    </div>
  )
}

function WornAvatarButton({
  avatar,
  onOpen
}: {
  avatar: AvatarItem
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('dashboard.glance.wornAria', {
        name: avatar.name,
        platform: platformName(avatar.platform, t)
      })}
      className={ROW_BUTTON}
    >
      <WornPicture url={avatar.imageUrl} />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-[var(--space-1)]">
        <span
          className="block max-w-full truncate text-sm font-semibold text-[var(--text)]"
          title={avatar.name}
        >
          {avatar.name}
        </span>
        <PlatformPill platform={avatar.platform} />
      </span>
    </button>
  )
}

/** The avatar picture at 4:3, like the Avatars page cards; a neutral box without one. */
function WornPicture({ url }: { url: string | null }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const image = useAvatar(url, ref)
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="block h-[45px] w-[60px] shrink-0 overflow-hidden rounded-[8px] bg-[var(--surface-hover)]"
    >
      {image && image !== failed ? (
        <img
          src={image}
          alt=""
          onError={() => setFailed(image)}
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  )
}

// ─── Latest invites ───────────────────────────────────────────────────────────

function LatestInvites({ platforms }: { platforms: readonly Platform[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const headingId = useId()
  const inbox = useInbox()
  const vrcFriends = useFriends('vrchat')
  const cvrFriends = useFriends('chilloutvr')
  const showInboxPage = useSettingsStore((s) => s.settings.showInboxPage)
  const [now, setNow] = useState(() => Date.now())
  const { latest, total } = useMemo(
    () => latestInvitePerPlatform(inbox.data?.items ?? [], platforms),
    [inbox.data, platforms]
  )
  const friendsById = useMemo(
    (): Record<Platform, Map<string, Friend>> => ({
      vrchat: new Map((vrcFriends.data ?? []).map((f) => [f.platformUserId, f])),
      chilloutvr: new Map((cvrFriends.data ?? []).map((f) => [f.platformUserId, f]))
    }),
    [vrcFriends.data, cvrFriends.data]
  )

  const hasRows = latest.length > 0
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const openInbox = (): void => useUiStore.getState().setActiveTab('inbox')

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <GlanceHeading
        id={headingId}
        label={t('dashboard.glance.invites')}
        action={
          showInboxPage && total > 0 ? (
            <button
              type="button"
              onClick={openInbox}
              aria-label={t('dashboard.glance.seeAllInvitesAria', { count: total })}
              className={HEADER_BUTTON}
            >
              {t('dashboard.seeAll', { count: total })}
            </button>
          ) : null
        }
      />
      <ul className="glass glass-information divide-y divide-[var(--border)] overflow-hidden">
        {hasRows ? (
          latest.map((item) => {
            const friend = friendsById[item.platform].get(item.senderId)
            const name = friend?.displayName ?? item.senderName ?? t('inbox.someone')
            const action = inboxActionText(item, t)
            const age = relativeInboxTime(item.receivedAt, now, i18n.language) ?? t('inbox.justNow')
            const body = (
              <>
                <InboxAvatar name={name} friend={friend} />
                <span className="flex min-w-0 flex-1 flex-col gap-[var(--space-0-5)]">
                  <span className="flex min-w-0 items-center gap-[var(--space-2)]">
                    <span
                      className="truncate text-sm font-semibold text-[var(--text)]"
                      title={name}
                    >
                      {name}
                    </span>
                    <PlatformPill platform={item.platform} className="shrink-0" />
                  </span>
                  <span className="truncate text-xs text-[var(--text-dim)]" title={action}>
                    {action}
                    <span aria-hidden="true"> · </span>
                    <time dateTime={new Date(item.receivedAt).toISOString()}>{age}</time>
                  </span>
                </span>
              </>
            )
            return (
              <li key={`${item.platform}:${item.id}`}>
                {showInboxPage ? (
                  <button
                    type="button"
                    onClick={openInbox}
                    aria-label={t('dashboard.glance.inviteAria', {
                      name,
                      action,
                      platform: platformName(item.platform, t),
                      age
                    })}
                    className={ROW_BUTTON}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={ROW}>{body}</div>
                )}
              </li>
            )
          })
        ) : (
          <li className={ROW}>
            <p className="text-sm text-[var(--text-dim)]">{t('dashboard.glance.noInvites')}</p>
          </li>
        )}
      </ul>
    </section>
  )
}
