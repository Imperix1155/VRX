/**
 * Explore's New and Recently updated tabs (owner, 2026-10-31). Each platform
 * names its own newest public worlds; under ALL the two lists alternate so
 * neither platform leads. A list is read when its tab opens and on Refresh,
 * never on a timer. The cards open the same world sheet as Popular now.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorldList } from '@shared/community'
import { useAuthStatus } from '../queries/auth'
import { useWorldList } from '../queries/community'
import { useFriendsStore } from '../stores/friends'
import { communitySource, interleave } from '../utils/community'
import { CommunityNotices } from './CommunityParts'
import WorldResults from './WorldResults'

export default function ExploreListPanel({ list }: { list: WorldList }): React.JSX.Element {
  const { t } = useTranslation()
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const showVrc = platformFilter !== 'chilloutvr'
  const showCvr = platformFilter !== 'vrchat'
  const vrcAuth = useAuthStatus('vrchat')
  const cvrAuth = useAuthStatus('chilloutvr')
  const vrc = useWorldList('vrchat', list, showVrc)
  const cvr = useWorldList('chilloutvr', list, showCvr)
  const vrcState = communitySource(vrcAuth, vrc)
  const cvrState = communitySource(cvrAuth, cvr)
  const sources = [
    ...(showVrc ? [{ platform: 'vrchat' as const, state: vrcState, query: vrc }] : []),
    ...(showCvr ? [{ platform: 'chilloutvr' as const, state: cvrState, query: cvr }] : [])
  ]
  // Under ALL, a platform the user isn't signed in to is a choice, not
  // missing data, so it adds no line; a single-platform filter says so.
  const noticed = sources.filter(
    ({ state }) => platformFilter !== 'all' || state.kind !== 'not-connected'
  )
  const vrcWorlds = showVrc && vrc.data?.ok ? vrc.data.worlds : null
  const cvrWorlds = showCvr && cvr.data?.ok ? cvr.data.worlds : null
  const worlds = useMemo(
    () => interleave([vrcWorlds ?? [], cvrWorlds ?? []]),
    [vrcWorlds, cvrWorlds]
  )
  const anyReady = vrcWorlds !== null || cvrWorlds !== null

  return (
    <section aria-label={t(list === 'new' ? 'explore.lists.new' : 'explore.lists.updated')}>
      <p className="canvas-text mb-[var(--space-3)] text-sm text-[var(--text-dim)]">
        {t(list === 'new' ? 'explore.lists.newHint' : 'explore.lists.updatedHint')}
      </p>
      <CommunityNotices
        sources={noticed}
        onRetry={(platform) => void (platform === 'vrchat' ? vrc : cvr).refetch()}
      />
      {anyReady && worlds.length === 0 ? (
        <p className="canvas-text text-sm text-[var(--text-dim)]">{t('explore.lists.empty')}</p>
      ) : null}
      {worlds.length > 0 ? <WorldResults worlds={worlds} /> : null}
    </section>
  )
}
