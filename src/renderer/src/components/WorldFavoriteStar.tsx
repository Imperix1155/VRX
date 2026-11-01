import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExploreWorld } from '@shared/explore'
import { FAVORITE_WORLDS_MAX } from '@shared/favorites'
import { useFavoriteWorlds, useSetFavoriteWorld } from '../queries/favorites'
import { FavoriteStarButton } from './FavoriteStar'

/**
 * The world sheet's star, beside the world name (owner, 2026-11-01). Starred
 * worlds show under Explore → Favorites. Kept only in VRX; main stores the
 * name and picture it already had, so starring makes no platform request.
 */
export default function WorldFavoriteStar({
  world
}: {
  world: ExploreWorld
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const favorites = useFavoriteWorlds(world.platform)
  const setFavorite = useSetFavoriteWorld()
  const [saving, setSaving] = useState(false)
  const owner = `${world.platform}:${world.worldId}`
  const [failure, setFailure] = useState<{ owner: string; text: string } | null>(null)
  if (favorites.accountId === null) return null
  const on = favorites.ids.has(world.worldId)
  const shownFailure = failure?.owner === owner ? failure.text : null

  const toggle = async (): Promise<void> => {
    setFailure(null)
    setSaving(true)
    const reason = await setFavorite(world, !on)
    setSaving(false)
    if (reason !== null) {
      setFailure({
        owner,
        text:
          reason === 'full'
            ? t('favorites.worldsFull', { count: FAVORITE_WORLDS_MAX })
            : t('favorites.saveFailed')
      })
    }
  }

  return (
    <>
      <FavoriteStarButton
        on={on}
        disabled={saving}
        label={t('favorites.worldLabel', { world: world.name })}
        hint={t(on ? 'favorites.remove' : 'favorites.add')}
        onToggle={() => void toggle()}
        className="shrink-0"
      />
      {shownFailure && (
        <p role="alert" className="basis-full text-xs text-[var(--text-dim)]">
          {shownFailure}
        </p>
      )}
    </>
  )
}
