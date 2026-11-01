/**
 * A person's full profile: pronouns, rank, bio and badges, then their public
 * worlds and groups behind "Show" buttons (depth on demand), and last the
 * Unfriend or block options (ProfileActions). The profile is
 * read once when this mounts; the worlds and groups only after a press. Both
 * platforms show the same fields in the same order, with "Not shown" where a
 * platform has nothing, so neither looks emptier by design.
 */
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommunityGroup, PersonProfile, ProfileBadge, ProfileResult } from '@shared/community'
import type { Platform, TrustRank } from '@shared/types'
import { useAvatar } from '../hooks/useAvatar'
import { useProfile, useProfileGroups, useProfileWorlds } from '../queries/community'
import { CommunityTile, TileGrid } from './CommunityParts'
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

const SMALL_HEADING =
  'mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]'

export default function ProfileDetails({
  platform,
  userId
}: {
  platform: Platform
  userId: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const profile = useProfile(platform, userId)
  const result = profile.data

  if (result === undefined) {
    const failed = profile.isError
    return (
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <p
          role={failed ? 'alert' : 'status'}
          className={`text-[13px] ${failed ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'}`}
        >
          {failed ? t('profile.error.unavailable') : t('profile.loading')}
        </p>
        {failed ? <RetryButton onRetry={() => void profile.refetch()} /> : null}
      </div>
    )
  }
  if (!result.ok) {
    return (
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <p role="alert" className="text-[13px] text-[var(--text-dim)]">
          {t(PROFILE_ERROR_KEYS[result.reason])}
        </p>
        {result.reason === 'unavailable' || result.reason === 'rate-limited' ? (
          <RetryButton onRetry={() => void profile.refetch()} />
        ) : null}
      </div>
    )
  }
  return <ProfileBody profile={result.profile} />
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

function ProfileBody({ profile }: { profile: PersonProfile }): React.JSX.Element {
  const { t } = useTranslation()
  const notShown = t('profile.notShown')
  const rank =
    profile.rank === null
      ? notShown
      : profile.rank.kind === 'vrchat-trust'
        ? t(TRUST_RANK_KEY[profile.rank.value])
        : profile.rank.value
  const facts: Array<[string, string]> = [
    ['profile.pronouns', profile.pronouns ?? notShown],
    ['profile.rank', rank]
  ]
  return (
    <div className="flex flex-col gap-[var(--space-4)]" data-profile-details={profile.platform}>
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
      />
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
        loading={result === undefined && !worlds.isError}
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
        loading={result === undefined && !groups.isError}
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
  if (loading) {
    return (
      <p role="status" className="text-[13px] text-[var(--text-dim)]">
        {t('profile.listLoading')}
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      <p role="alert" className="text-[13px] text-[var(--text-dim)]">
        {t('profile.listError')}
      </p>
      <RetryButton onRetry={onRetry} />
    </div>
  )
}
