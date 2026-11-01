import type { Friend } from '@shared/types'
import {
  isFavoriteAccount,
  useFavoriteFriendKeys,
  useFavoriteFriends,
  useSetFavoriteFriends
} from '../queries/favorites'
import FavoriteMenu from './FavoriteMenu'

/**
 * The friend details star, beside the alerts bell (owner, 2026-11-01). It
 * opens the favorite panel: VRX's own star, which covers every account of a
 * linked person together, and each account's own game favorite groups.
 */
export default function FriendFavoriteStar({
  accounts,
  name,
  drawerOpen = true,
  onLeave
}: {
  accounts: readonly Friend[]
  name: string
  drawerOpen?: boolean
  onLeave?: () => void
}): React.JSX.Element | null {
  const keys = useFavoriteFriendKeys()
  const vrchat = useFavoriteFriends('vrchat')
  const chilloutvr = useFavoriteFriends('chilloutvr')
  const setFavorite = useSetFavoriteFriends()
  if (accounts.length === 0) return null
  const lists = { vrchat, chilloutvr }
  // VRX's star reads starred while any shown account is, so unstarring clears all.
  const on = isFavoriteAccount(keys, accounts)

  return (
    <FavoriteMenu
      name={name}
      shape="round"
      placement="above"
      open={drawerOpen}
      onLeave={onLeave}
      local={{
        on,
        writable: accounts.every((a) => lists[a.platform].writable),
        toggle: async () => {
          const reason = await setFavorite(accounts, !on)
          if (reason === null) return null
          return reason === 'full' ? 'favorites.friendsFull' : 'favorites.saveFailed'
        }
      }}
      games={accounts.map((a) => ({
        platform: a.platform,
        kind: 'friend' as const,
        friendId: a.platformUserId
      }))}
    />
  )
}
