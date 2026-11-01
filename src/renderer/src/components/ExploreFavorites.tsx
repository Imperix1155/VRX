/**
 * Explore → Favorites (owner, 2026-11-01): the worlds this account starred in
 * VRX, newest first, then the favorite worlds in the account's own VRChat or
 * ChilloutVR favorite groups. Under ALL the two platforms alternate so
 * neither leads. VRX's stars make no platform request; the account's
 * favorites come from main's one read per sign-in. A card opens the same
 * world sheet, with its rooms and Join, as every other Explore list.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExploreWorld } from '@shared/explore'
import type { Platform } from '@shared/types'
import { useFavoriteWorlds } from '../queries/favorites'
import { GAME_FAVORITES_HEADING, useGameFavorites } from '../queries/gameFavorites'
import { useFriendsStore } from '../stores/friends'
import { interleave } from '../utils/community'
import WorldResults from './WorldResults'

const NO_WORLDS: readonly ExploreWorld[] = []

/** VRX's stars first, then the account's own favorites not already listed. */
function merged(
  local: readonly ExploreWorld[],
  game: readonly ExploreWorld[] | undefined
): readonly ExploreWorld[] {
  if (!game || game.length === 0) return local
  const seen = new Set(local.map((world) => world.worldId))
  return [...local, ...game.filter((world) => !seen.has(world.worldId))]
}

export default function ExploreFavorites(): React.JSX.Element {
  const { t } = useTranslation()
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const showVrc = platformFilter !== 'chilloutvr'
  const showCvr = platformFilter !== 'vrchat'
  const vrc = useFavoriteWorlds('vrchat', { enabled: showVrc, rereadOnShow: true })
  const cvr = useFavoriteWorlds('chilloutvr', { enabled: showCvr, rereadOnShow: true })
  const vrcGame = useGameFavorites('vrchat', { enabled: showVrc, rereadOnShow: true })
  const cvrGame = useGameFavorites('chilloutvr', { enabled: showCvr, rereadOnShow: true })
  const vrcGameWorlds = vrcGame.favorites?.worldList
  const cvrGameWorlds = cvrGame.favorites?.worldList
  const vrcWorlds = useMemo(
    () => (showVrc ? merged(vrc.worlds, vrcGameWorlds) : NO_WORLDS),
    [showVrc, vrc.worlds, vrcGameWorlds]
  )
  const cvrWorlds = useMemo(
    () => (showCvr ? merged(cvr.worlds, cvrGameWorlds) : NO_WORLDS),
    [showCvr, cvr.worlds, cvrGameWorlds]
  )
  const worlds = useMemo(() => interleave([vrcWorlds, cvrWorlds]), [vrcWorlds, cvrWorlds])
  const loading =
    (showVrc && (vrc.isLoading || vrcGame.state === 'loading')) ||
    (showCvr && (cvr.isLoading || cvrGame.state === 'loading'))
  const failed = [
    showVrc && unreadable(vrcGame.state) ? 'vrchat' : null,
    showCvr && unreadable(cvrGame.state) ? 'chilloutvr' : null
  ].filter((platform): platform is Platform => platform !== null)
  // An expired card renews its reference by reading both lists again. Main
  // answers the account's favorites from memory, with fresh references.
  const recover = async (platform: Platform): Promise<readonly ExploreWorld[]> => {
    const [local, game] = await Promise.all([
      (platform === 'vrchat' ? vrc : cvr).refetch(),
      (platform === 'vrchat' ? vrcGame : cvrGame).reread()
    ])
    return merged(local, game)
  }

  return (
    <section aria-label={t('explore.lists.favorites')}>
      <p className="canvas-text mb-[var(--space-3)] text-sm text-[var(--text-dim)]">
        {t('explore.lists.favoritesHint')}
      </p>
      {failed.map((platform) => (
        <p
          key={platform}
          className="canvas-text mb-[var(--space-2)] text-sm text-[var(--text-dim)]"
        >
          {t('favorites.menu.loadFailed', { platform: t(GAME_FAVORITES_HEADING[platform]) })}
        </p>
      ))}
      {!loading && worlds.length === 0 ? (
        <p className="canvas-text text-sm text-[var(--text-dim)]">
          {t('explore.lists.favoritesEmpty')}
        </p>
      ) : null}
      {worlds.length > 0 ? <WorldResults worlds={worlds} recover={recover} /> : null}
    </section>
  )
}

function unreadable(state: string): boolean {
  return state === 'unavailable' || state === 'rate-limited'
}
