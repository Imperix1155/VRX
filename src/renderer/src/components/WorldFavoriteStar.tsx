import { useTranslation } from 'react-i18next'
import type { ExploreWorld } from '@shared/explore'
import { FAVORITE_WORLDS_MAX } from '@shared/favorites'
import { useFavoriteWorlds, useSetFavoriteWorld } from '../queries/favorites'
import FavoriteMenu from './FavoriteMenu'

/**
 * The world sheet's star, beside the world name (owner, 2026-11-01). It opens
 * the favorite panel: VRX's own star and the account's own game favorite
 * groups. Favorites from both show under Explore → Favorites.
 */
export default function WorldFavoriteStar({
  world
}: {
  world: ExploreWorld
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const favorites = useFavoriteWorlds(world.platform)
  const setFavorite = useSetFavoriteWorld()
  if (favorites.accountId === null) return null
  const on = favorites.ids.has(world.worldId)

  return (
    <FavoriteMenu
      key={`${world.platform}:${world.worldId}`}
      name={world.name}
      shape="square"
      placement="below"
      anchored={false}
      local={{
        on,
        writable: true,
        toggle: async () => {
          const reason = await setFavorite(world, !on)
          if (reason === null) return null
          return reason === 'full'
            ? t('favorites.worldsFull', { count: FAVORITE_WORLDS_MAX })
            : 'favorites.saveFailed'
        }
      }}
      games={[{ platform: world.platform, kind: 'world', world }]}
    />
  )
}
