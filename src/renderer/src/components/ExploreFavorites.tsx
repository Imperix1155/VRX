/**
 * Explore → Favorites (owner, 2026-11-01): the worlds this account starred,
 * newest first. Under ALL the two platforms alternate so neither leads.
 * Stars are kept only in VRX, so reading this list makes no platform
 * request; a card opens the same world sheet, with its rooms and Join, as
 * every other Explore list.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExploreWorld } from '@shared/explore'
import type { Platform } from '@shared/types'
import { useFavoriteWorlds } from '../queries/favorites'
import { useFriendsStore } from '../stores/friends'
import { interleave } from '../utils/community'
import WorldResults from './WorldResults'

export default function ExploreFavorites(): React.JSX.Element {
  const { t } = useTranslation()
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const showVrc = platformFilter !== 'chilloutvr'
  const showCvr = platformFilter !== 'vrchat'
  const vrc = useFavoriteWorlds('vrchat', { enabled: showVrc, rereadOnShow: true })
  const cvr = useFavoriteWorlds('chilloutvr', { enabled: showCvr, rereadOnShow: true })
  const vrcWorlds = showVrc ? vrc.worlds : null
  const cvrWorlds = showCvr ? cvr.worlds : null
  const worlds = useMemo(
    () => interleave([vrcWorlds ?? [], cvrWorlds ?? []]),
    [vrcWorlds, cvrWorlds]
  )
  const loading = (showVrc && vrc.isLoading) || (showCvr && cvr.isLoading)
  // An expired card renews its reference by reading the favorites again.
  const recover = (platform: Platform): Promise<readonly ExploreWorld[]> =>
    (platform === 'vrchat' ? vrc : cvr).refetch()

  return (
    <section aria-label={t('explore.lists.favorites')}>
      <p className="canvas-text mb-[var(--space-3)] text-sm text-[var(--text-dim)]">
        {t('explore.lists.favoritesHint')}
      </p>
      {!loading && worlds.length === 0 ? (
        <p className="canvas-text text-sm text-[var(--text-dim)]">
          {t('explore.lists.favoritesEmpty')}
        </p>
      ) : null}
      {worlds.length > 0 ? <WorldResults worlds={worlds} recover={recover} /> : null}
    </section>
  )
}
