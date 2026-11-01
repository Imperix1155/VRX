/**
 * Search page (owner, 2026-10-31). Finds people and worlds on VRChat and
 * ChilloutVR by name. A search goes out only when the user presses Enter or
 * the Search button, never while typing, and main spaces searches out and
 * reuses answers for 5 minutes. People open their full profile in a sheet;
 * worlds open the same world sheet as Explore, with rooms and Join.
 *
 * One unified page: under ALL the two platforms' results alternate in each
 * section, so neither platform leads.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COMMUNITY_QUERY_MAX_LENGTH,
  normalizeCommunityQuery,
  type PersonSummary
} from '@shared/community'
import { useAuthStatus } from '../queries/auth'
import { useCommunitySearch } from '../queries/community'
import { useFriendsStore } from '../stores/friends'
import { communitySource, interleave, platformName } from '../utils/community'
import CommunitySheet from './CommunitySheet'
import { CommunityHeading, CommunityNotices, CommunityTile, TileGrid } from './CommunityParts'
import ProfileDetails from './ProfileDetails'
import type { RecoverWorlds } from '../hooks/useExploreWorldSelection'
import WorldResults from './WorldResults'

export default function SearchView(): React.JSX.Element {
  const { t } = useTranslation()
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const showVrc = platformFilter !== 'chilloutvr'
  const showCvr = platformFilter !== 'vrchat'
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [tooShort, setTooShort] = useState(false)
  const vrcAuth = useAuthStatus('vrchat')
  const cvrAuth = useAuthStatus('chilloutvr')
  const vrc = useCommunitySearch('vrchat', query, showVrc)
  const cvr = useCommunitySearch('chilloutvr', query, showCvr)
  const vrcState = communitySource(vrcAuth, vrc)
  const cvrState = communitySource(cvrAuth, cvr)
  const sources = [
    ...(showVrc ? [{ platform: 'vrchat' as const, state: vrcState }] : []),
    ...(showCvr ? [{ platform: 'chilloutvr' as const, state: cvrState }] : [])
  ]
  // Under ALL, a platform the user isn't signed in to adds no line.
  const noticed = sources.filter(
    ({ state }) => platformFilter !== 'all' || state.kind !== 'not-connected'
  )
  const vrcResult = showVrc && vrc.data?.ok ? vrc.data : null
  const cvrResult = showCvr && cvr.data?.ok ? cvr.data : null
  const people = useMemo(
    () => interleave([vrcResult?.people ?? [], cvrResult?.people ?? []]),
    [vrcResult, cvrResult]
  )
  const worlds = useMemo(
    () => interleave([vrcResult?.worlds ?? [], cvrResult?.worlds ?? []]),
    [vrcResult, cvrResult]
  )
  const answered = vrcResult !== null || cvrResult !== null
  // An expired world card renews its reference by reading these same results
  // again (main answers from its 5 minute cache when it can).
  const recover: RecoverWorlds = async (platform) => {
    const result = await (platform === 'vrchat' ? vrc : cvr).refetch()
    return result.data?.ok ? result.data.worlds : []
  }

  const [person, setPerson] = useState<PersonSummary | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const topRef = useRef<HTMLFormElement>(null)
  const closePerson = useCallback(() => {
    const opener = openerRef.current
    openerRef.current = null
    setPerson(null)
    if (opener?.isConnected) opener.focus()
    else topRef.current?.querySelector('input')?.focus()
  }, [])

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    const next = normalizeCommunityQuery(draft)
    setTooShort(next === null && draft.trim().length > 0)
    if (next === null) return
    setPerson(null)
    setQuery(next)
  }

  return (
    <div>
      <form
        ref={topRef}
        role="search"
        onSubmit={submit}
        className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)]"
      >
        <input
          type="search"
          value={draft}
          maxLength={COMMUNITY_QUERY_MAX_LENGTH}
          onChange={(event) => {
            setDraft(event.target.value)
            if (tooShort) setTooShort(false)
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.aria')}
          aria-describedby="community-search-hint"
          className="canvas-control min-w-0 flex-1 rounded-control border bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          type="submit"
          className="canvas-control shrink-0 rounded-control px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
        >
          {t('search.submit')}
        </button>
      </form>
      <p
        id="community-search-hint"
        role={tooShort ? 'alert' : undefined}
        className="canvas-text mb-[var(--space-4)] text-xs text-[var(--text-dim)]"
      >
        {tooShort ? t('community.error.invalid-query') : t('search.hint')}
      </p>

      <CommunityNotices
        sources={noticed}
        onRetry={(platform) => void (platform === 'vrchat' ? vrc : cvr).refetch()}
      />

      {answered ? (
        <div className="flex flex-col gap-[var(--space-6)]">
          <section aria-label={t('search.people')}>
            <CommunityHeading>{t('search.people')}</CommunityHeading>
            {people.length === 0 ? (
              <p className="canvas-text text-sm text-[var(--text-dim)]">{t('search.noPeople')}</p>
            ) : (
              <TileGrid min={220}>
                {people.map((item) => (
                  <PersonTile
                    key={`${item.platform}:${item.userId}`}
                    person={item}
                    onOpen={(opener) => {
                      openerRef.current = opener
                      setPerson(item)
                    }}
                  />
                ))}
              </TileGrid>
            )}
          </section>
          <section aria-label={t('search.worlds')}>
            <CommunityHeading>{t('search.worlds')}</CommunityHeading>
            {worlds.length === 0 ? (
              <p className="canvas-text text-sm text-[var(--text-dim)]">{t('search.noWorlds')}</p>
            ) : (
              <WorldResults worlds={worlds} recover={recover} />
            )}
          </section>
        </div>
      ) : null}

      <CommunitySheet
        item={person}
        itemKey={(item) => `${item.platform}:${item.userId}`}
        header={(item) => ({
          platform: item.platform,
          title: item.displayName,
          imageUrl: item.imageUrl,
          ariaLabel: t('profile.aria', {
            name: item.displayName,
            platform: platformName(t, item.platform)
          }),
          tags: item.isFriend ? [t('search.friend')] : [],
          more: [{ label: t('profile.userId'), value: item.userId, mono: true }]
        })}
        onClose={closePerson}
      >
        {(item) => <ProfileDetails platform={item.platform} userId={item.userId} />}
      </CommunitySheet>
    </div>
  )
}

function PersonTile({
  person,
  onOpen
}: {
  person: PersonSummary
  onOpen: (opener: HTMLElement) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <CommunityTile
      platform={person.platform}
      title={person.displayName}
      detail={person.isFriend ? t('search.friend') : null}
      imageUrl={person.imageUrl}
      onOpen={onOpen}
      ariaLabel={t('search.openPersonAria', {
        name: person.displayName,
        platform: platformName(t, person.platform)
      })}
    />
  )
}
