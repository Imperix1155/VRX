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
  owner,
  name,
  drawerOpen = true,
  onLeave
}: {
  accounts: readonly Friend[]
  /** Who the panel belongs to (a linked person, or one account). Defaults to
   *  the accounts, so a linked person whose accounts change keeps it open. */
  owner?: string
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
      // Friend details stay open while another friend is picked: a different
      // person starts with a folded panel and no earlier save or failure.
      key={owner ?? accounts.map((a) => `${a.platform}:${a.platformUserId}`).join('|')}
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
