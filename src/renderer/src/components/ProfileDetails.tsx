/**
 * A person's full profile: pronouns, rank, bio and badges, then their public
 * worlds and groups behind "Show" buttons (depth on demand), and last the
 * Unfriend or block options (ProfileActions). The profile is
 * read once when this mounts; the worlds and groups only after a press. Both
 * platforms show the same fields in the same order, with "Not shown" where a
 * platform has nothing, so neither looks emptier by design. One exception:
 * inside friend details, a VRChat trust rank already shows above the profile,
 * so the profile there skips its Rank row instead of repeating it.
 *
 * Someone who is not a friend yet gets one friend action on top (owner,
 * 2026-11-01): Accept and Decline when their request is waiting in the Inbox,
 * otherwise Add friend. Main sends it only to someone a search listed. Friend
 * details leave it out: everyone there is on the friends list, and a friend
 * unfriended there stays shown only until the platform's own message.
 */
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommunityGroup, PersonProfile, ProfileBadge, ProfileResult } from '@shared/community'
import type { FriendActionResult, FriendRequestAnswer } from '@shared/friendActions'
import type { Platform, TrustRank } from '@shared/types'
import { useAvatar } from '../hooks/useAvatar'
import { useAuthStatus } from '../queries/auth'
import { useProfile, useProfileGroups, useProfileWorlds } from '../queries/community'
import { sendFriendRequest, useAnswerFriendRequest } from '../queries/friendActions'
import { useInbox } from '../queries/inbox'
import { platformName } from '../utils/community'
import { FRIEND_ACTION_BUTTON, FRIEND_ACTION_ERROR_KEYS } from '../utils/friendActions'
import { CommunityTile, TileGrid } from './CommunityParts'
import GoToAccountsButton from './GoToAccountsButton'
import ProfileActions from './ProfileActions'

/** Quoted literals keep the locale parity scan aware of these keys. */
const TRUST_RANK_KEY: Record<NonNullable<TrustRank>, string> = {
  visitor: 'drawer.trustRank.visitor',
  new: 'drawer.trustRank.new',
  user: 'drawer.trustRank.user',
  known: 'drawer.trustRank.known',
  trusted: 'drawer.trustRank.trusted',
  nuisance: 'drawer.trustRank.nuisance'
}
type ProfileFailure = Extract<ProfileResult, { ok: false }>['reason']
const PROFILE_ERROR_KEYS: Record<ProfileFailure, string> = {
  unavailable: 'profile.error.unavailable',
  'rate-limited': 'profile.error.rate-limited',
  'not-authenticated': 'profile.error.not-authenticated',
  'unknown-person': 'profile.error.unknown-person',
  'not-found': 'profile.error.not-found'
}

/** Failures that leave the profile unloaded (red); the rest are answers (dim). */
const NEVER_LOADED: ReadonlySet<ProfileFailure> = new Set([
  'unavailable',
  'rate-limited',
  'not-authenticated'
])

const SMALL_HEADING =
  'mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]'

export default function ProfileDetails({
  platform,
  userId,
  showTrust = true,
  showFriendAction = true,
  panelOpen = true
}: {
  platform: Platform
  userId: string
  /** False where the VRChat trust rank already shows just above (the friend
   *  card), so the profile does not repeat it. */
  showTrust?: boolean
  /** False in friend details, where the person is on the friends list. */
  showFriendAction?: boolean
  /** False while the drawer or sheet holding the profile is closed. */
  panelOpen?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const profile = useProfile(platform, userId)
  const result = profile.data
  const lineRef = useRef<HTMLDivElement>(null)

  if (result === undefined || !result.ok) {
    // Retry shows the loading words until the platform answers again.
    const loading = profile.isFetching || (result === undefined && !profile.isError)
    // A read that failed outright reads like the platform's "unavailable".
    const reason: ProfileFailure = result === undefined ? 'unavailable' : result.reason
    let action: React.JSX.Element | null = null
    if (loading) {
      // Nothing to press until the platform answers.
    } else if (reason === 'not-authenticated') {
      // Signing in happens in Settings → Accounts, as on the pages.
      action = <GoToAccountsButton label={t('community.openAccounts')} />
    } else if (reason === 'unavailable' || reason === 'rate-limited') {
      action = (
        <RetryButton
          onRetry={() => {
            void profile.refetch()
            focusLine(lineRef)
          }}
        />
      )
    }
    return (
      <StateLine
        lineRef={lineRef}
        loading={loading}
        text={loading ? t('profile.loading') : t(PROFILE_ERROR_KEYS[reason])}
        missing={!loading && NEVER_LOADED.has(reason)}
      >
        {action}
      </StateLine>
    )
  }
  return (
    <ProfileBody
      profile={result.profile}
      showTrust={showTrust}
      showFriendAction={showFriendAction}
      panelOpen={panelOpen}
    />
  )
}

/**
 * One loading or failure line. Retry moves keyboard focus to the line, so it
 * isn't lost when Retry leaves; the line stays the same element, with no role
 * of its own, while its words switch between loading and the answer. Something
 * that never loaded is red, as on the pages (DESIGN.md, Locked rule 5).
 */
function StateLine({
  lineRef,
  loading,
  text,
  missing,
  children
}: {
  lineRef: React.RefObject<HTMLDivElement | null>
  loading: boolean
  text: string
  missing: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      ref={lineRef}
      data-profile-line=""
      tabIndex={-1}
      className="flex flex-wrap items-center gap-[var(--space-2)] outline-none"
    >
      <p
        role={loading ? 'status' : 'alert'}
        className={`text-[13px] ${missing ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'}`}
      >
        {text}
      </p>
      {children}
    </div>
  )
}

function focusLine(lineRef: React.RefObject<HTMLDivElement | null>): void {
  lineRef.current?.focus({ preventScroll: true })
}

function RetryButton({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onRetry}
      className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
    >
      {t('community.retry')}
    </button>
  )
}

type Translate = ReturnType<typeof useTranslation>['t']

/** Pronouns, then Rank: skipped only when `showTrust` is off and the rank is
 *  the VRChat trust rank that friend details already show above. */
function profileFacts(
  profile: PersonProfile,
  showTrust: boolean,
  t: Translate
): Array<[string, string]> {
  const notShown = t('profile.notShown')
  const pronouns: [string, string] = ['profile.pronouns', profile.pronouns ?? notShown]
  if (profile.rank === null) return [pronouns, ['profile.rank', notShown]]
  if (profile.rank.kind !== 'vrchat-trust') return [pronouns, ['profile.rank', profile.rank.value]]
  if (!showTrust) return [pronouns]
  return [pronouns, ['profile.rank', t(TRUST_RANK_KEY[profile.rank.value])]]
}

function ProfileBody({
  profile,
  showTrust,
  showFriendAction,
  panelOpen
}: {
  profile: PersonProfile
  showTrust: boolean
  showFriendAction: boolean
  panelOpen: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const facts = profileFacts(profile, showTrust, t)
  return (
    <div className="flex flex-col gap-[var(--space-4)]" data-profile-details={profile.platform}>
      {showFriendAction && profile.isFriend === false ? (
        <FriendAction
          platform={profile.platform}
          userId={profile.userId}
          name={profile.displayName}
        />
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-[13px]">
        {facts.map(([labelKey, value]) => (
          <div key={labelKey} className="contents">
            <dt className="text-[var(--text-dim)]">{t(labelKey)}</dt>
            <dd className="min-w-0 truncate text-[var(--text)]" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className={SMALL_HEADING}>{t('profile.bio')}</h3>
        <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-[var(--text)]">
          {profile.bio ?? t('profile.noBio')}
        </p>
      </div>
      <div>
        <h3 className={SMALL_HEADING}>{t('profile.badges')}</h3>
        {profile.badges.length === 0 ? (
          <p className="text-[13px] text-[var(--text-dim)]">{t('profile.noBadges')}</p>
        ) : (
          <ul className="flex flex-wrap gap-[var(--space-2)]">
            {profile.badges.map((badge, index) => (
              <BadgeChip key={`${badge.name}:${index}`} badge={badge} />
            ))}
          </ul>
        )}
      </div>
      <ProfileLists platform={profile.platform} userId={profile.userId} />
      <ProfileActions
        key={`${profile.platform}:${profile.userId}`}
        platform={profile.platform}
        userId={profile.userId}
        name={profile.displayName}
        notFriend={profile.isFriend === false}
        panelOpen={panelOpen}
      />
    </div>
  )
}

type FriendActionState =
  | { kind: 'idle' }
  | { kind: 'sending'; action: FriendRequestAnswer | 'add' }
  | { kind: 'done'; action: FriendRequestAnswer | 'add' }
  | { kind: 'failed'; result: Extract<FriendActionResult, { ok: false }> }

/**
 * One friend action for someone who is not a friend yet. A request of theirs
 * waiting in the Inbox gets Accept and Decline (the same answer as there);
 * otherwise Add friend. Never shown on the signed-in user's own profile.
 */
function FriendAction({
  platform,
  userId,
  name
}: {
  platform: Platform
  userId: string
  name: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const self = useAuthStatus(platform).data?.accountId ?? null
  const inbox = useInbox()
  const answerFriendRequest = useAnswerFriendRequest()
  const [state, setState] = useState<FriendActionState>({ kind: 'idle' })
  const sameId = (a: string, b: string): boolean =>
    platform === 'chilloutvr' ? a.toLowerCase() === b.toLowerCase() : a === b
  if (self !== null && sameId(self, userId)) return null
  const request = inbox.data?.items.find(
    (item) =>
      item.platform === platform && item.kind === 'friend-request' && sameId(item.senderId, userId)
  )

  const run = async (
    action: FriendRequestAnswer | 'add',
    send: () => Promise<FriendActionResult>
  ): Promise<void> => {
    setState({ kind: 'sending', action })
    const result = await send()
    setState(result.ok ? { kind: 'done', action } : { kind: 'failed', result })
  }
  const sending = state.kind === 'sending' ? state.action : null
  const status =
    state.kind === 'done'
      ? t(
          state.action === 'add'
            ? 'friendActions.sent'
            : state.action === 'accept'
              ? 'friendActions.accepted'
              : 'friendActions.declined',
          { name }
        )
      : state.kind === 'failed'
        ? t(FRIEND_ACTION_ERROR_KEYS[state.result.reason], {
            platform: platformName(t, platform)
          })
        : null

  let buttons: React.JSX.Element | null = null
  if (state.kind !== 'done' && request) {
    buttons = (
      <>
        <button
          type="button"
          onClick={() =>
            void run('accept', () => answerFriendRequest(platform, request.id, 'accept'))
          }
          disabled={sending !== null}
          aria-label={t('friendActions.acceptAria', { name })}
          className={FRIEND_ACTION_BUTTON}
        >
          {sending === 'accept' ? t('friendActions.accepting') : t('friendActions.accept')}
        </button>
        <button
          type="button"
          onClick={() =>
            void run('decline', () => answerFriendRequest(platform, request.id, 'decline'))
          }
          disabled={sending !== null}
          aria-label={t('friendActions.declineAria', { name })}
          className="shrink-0 rounded-control px-[var(--space-3)] py-[var(--space-1)] text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] disabled:cursor-default disabled:opacity-50 motion-safe:transition-colors cursor-pointer"
        >
          {sending === 'decline' ? t('friendActions.declining') : t('friendActions.decline')}
        </button>
      </>
    )
  } else if (state.kind !== 'done') {
    buttons = (
      <button
        type="button"
        onClick={() => void run('add', () => sendFriendRequest(platform, userId))}
        disabled={sending !== null}
        aria-label={t('friendActions.addAria', { name, platform: platformName(t, platform) })}
        className={FRIEND_ACTION_BUTTON}
      >
        {sending === 'add' ? t('friendActions.adding') : t('friendActions.add')}
      </button>
    )
  }

  return (
    // The row keeps a button's height once the button gives way to words.
    <div className="flex min-h-[28px] flex-wrap items-center gap-x-[var(--space-2)] gap-y-[var(--space-1)]">
      {request && state.kind !== 'done' ? (
        <p className="text-[13px] text-[var(--text)]">{t('friendActions.incoming')}</p>
      ) : null}
      {buttons}
      <p
        role="status"
        className={`min-w-0 text-[13px] empty:hidden ${
          state.kind === 'failed' ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'
        }`}
      >
        {state.kind === 'done' ? (
          <span aria-hidden="true" className="mr-[var(--space-1)]">
            ✓
          </span>
        ) : null}
        {status}
      </p>
    </div>
  )
}

function BadgeChip({ badge }: { badge: ProfileBadge }): React.JSX.Element {
  const ref = useRef<HTMLLIElement>(null)
  const image = useAvatar(badge.imageUrl, ref)
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <li
      ref={ref}
      className="flex max-w-full items-center gap-[var(--space-1)] rounded-pill border px-[var(--space-2)] py-[var(--space-0-5)] text-[12px] text-[var(--text)]"
      style={{ borderColor: 'var(--border)', background: 'var(--control-fill)' }}
    >
      {image && failed !== image ? (
        <img
          src={image}
          alt=""
          className="h-[16px] w-[16px] shrink-0 rounded-[4px] object-cover"
          onError={() => setFailed(image)}
        />
      ) : null}
      <span className="truncate" title={badge.name}>
        {badge.name}
      </span>
    </li>
  )
}

/**
 * "Show worlds" and "Show groups" side by side; each list is read on its first
 * press only and stays cached while the profile is open.
 */
function ProfileLists({
  platform,
  userId
}: {
  platform: Platform
  userId: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [worldsOpen, setWorldsOpen] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const worldsId = useId()
  const groupsId = useId()
  const button = (
    open: boolean,
    toggle: () => void,
    controls: string,
    show: string,
    hide: string
  ): React.JSX.Element => (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={toggle}
      className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-[12px] font-semibold text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
    >
      {t(open ? hide : show)}
    </button>
  )
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="flex flex-wrap gap-[var(--space-2)]">
        {button(
          worldsOpen,
          () => setWorldsOpen((v) => !v),
          worldsId,
          'profile.showWorlds',
          'profile.hideWorlds'
        )}
        {button(
          groupsOpen,
          () => setGroupsOpen((v) => !v),
          groupsId,
          'profile.showGroups',
          'profile.hideGroups'
        )}
      </div>
      <div id={worldsId} hidden={!worldsOpen}>
        {worldsOpen ? (
          <>
            <h3 className={SMALL_HEADING}>{t('profile.worlds')}</h3>
            <ProfileWorldsList platform={platform} userId={userId} />
          </>
        ) : null}
      </div>
      <div id={groupsId} hidden={!groupsOpen}>
        {groupsOpen ? (
          <>
            <h3 className={SMALL_HEADING}>{t('profile.groups')}</h3>
            <ProfileGroupsList platform={platform} userId={userId} />
          </>
        ) : null}
      </div>
    </div>
  )
}

function ProfileWorldsList({
  platform,
  userId
}: {
  platform: Platform
  userId: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const worlds = useProfileWorlds(platform, userId, true)
  const result = worlds.data
  if (result === undefined || !result.ok) {
    return (
      <ListState
        loading={worlds.isFetching || (result === undefined && !worlds.isError)}
        onRetry={() => void worlds.refetch()}
      />
    )
  }
  if (result.worlds.length === 0) {
    return <p className="text-[13px] text-[var(--text-dim)]">{t('profile.noWorlds')}</p>
  }
  return (
    <>
      <TileGrid min={128}>
        {result.worlds.map((world) => (
          <CommunityTile
            key={world.worldId}
            platform={world.platform}
            title={world.name}
            imageUrl={world.imageUrl}
            shape="wide"
          />
        ))}
      </TileGrid>
      {!result.complete ? (
        <p className="mt-[var(--space-2)] text-xs text-[var(--text-dim)]">{t('profile.partial')}</p>
      ) : null}
    </>
  )
}

function ProfileGroupsList({
  platform,
  userId
}: {
  platform: Platform
  userId: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const groups = useProfileGroups(platform, userId, true)
  const result = groups.data
  if (result === undefined || !result.ok) {
    return (
      <ListState
        loading={groups.isFetching || (result === undefined && !groups.isError)}
        onRetry={() => void groups.refetch()}
      />
    )
  }
  if (result.groups.length === 0) {
    return <p className="text-[13px] text-[var(--text-dim)]">{t('profile.noGroups')}</p>
  }
  return (
    <>
      <ul className="flex flex-col gap-[var(--space-1)]">
        {result.groups.map((group) => (
          <GroupLine key={group.groupId} group={group} />
        ))}
      </ul>
      {!result.complete ? (
        <p className="mt-[var(--space-2)] text-xs text-[var(--text-dim)]">{t('profile.partial')}</p>
      ) : null}
    </>
  )
}

function GroupLine({ group }: { group: CommunityGroup }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const detail = [
    group.code,
    group.memberCount === null
      ? null
      : t('groups.members', {
          count: group.memberCount,
          formatted: new Intl.NumberFormat(i18n.language).format(group.memberCount)
        })
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  return (
    <li className="flex min-w-0 items-baseline gap-[var(--space-2)] text-[13px]">
      <span className="min-w-0 truncate font-semibold text-[var(--text)]" title={group.name}>
        {group.name}
      </span>
      {detail ? <span className="shrink-0 text-xs text-[var(--text-dim)]">{detail}</span> : null}
    </li>
  )
}

function ListState({
  loading,
  onRetry
}: {
  loading: boolean
  onRetry: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const lineRef = useRef<HTMLDivElement>(null)
  return (
    <StateLine
      lineRef={lineRef}
      loading={loading}
      text={t(loading ? 'profile.listLoading' : 'profile.listError')}
      missing={!loading}
    >
      {loading ? null : (
        <RetryButton
          onRetry={() => {
            onRetry()
            focusLine(lineRef)
          }}
        />
      )}
    </StateLine>
  )
}
