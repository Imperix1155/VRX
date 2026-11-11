import type { GameFavorites } from '@shared/gameFavorites'
import type { Friend, Platform } from '@shared/types'

/** One part of the Favorites section: an account's favorite group, or VRX's own stars. */
export interface FavoriteSubgroup<Row> {
  /** Stable across live updates: the platform and the group's own key. */
  key: string
  /** Null for the friends starred in VRX only. */
  platform: Platform | null
  /** The group's name in the game; null for VRX's own stars. */
  name: string | null
  rows: Row[]
}

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/**
 * Splits the Favorites rows by the favorite groups in the user's accounts:
 * VRChat's groups in the account's order, then ChilloutVR's categories, then
 * the friends starred in VRX only. A row shows once, under the first group
 * that holds any of its accounts, and each part keeps the order the rows
 * arrived in. For a linked person the account that is in the game is asked
 * first.
 *
 * Returns an empty list when there would be fewer than two parts, so a user
 * with one group, or with VRX stars only, sees the plain Favorites section.
 */
export function splitFavoritesByGroup<
  Row extends {
    accounts: readonly (Pick<Friend, 'platform' | 'platformUserId'> &
      Partial<Pick<Friend, 'presence'>>)[]
  }
>(
  rows: readonly Row[],
  game: Readonly<Record<Platform, GameFavorites | null>>
): FavoriteSubgroup<Row>[] {
  const parts = new Map<string, FavoriteSubgroup<Row>>()
  for (const platform of PLATFORMS) {
    for (const group of game[platform]?.groups.friend ?? []) {
      const key = `${platform}:${group.key}`
      parts.set(key, { key, platform, name: group.name, rows: [] })
    }
  }
  const starred: FavoriteSubgroup<Row> = { key: 'vrx', platform: null, name: null, rows: [] }

  type Account = Row['accounts'][number]
  const homeFor = (accounts: readonly Account[]): FavoriteSubgroup<Row> | undefined => {
    for (const platform of PLATFORMS) {
      const favorites = game[platform]
      if (favorites === null) continue
      const held = new Set(
        accounts
          .filter((account) => account.platform === platform)
          // Own-property lookup: an ID is never read off the object's prototype.
          .flatMap((account) =>
            Object.hasOwn(favorites.friends, account.platformUserId)
              ? (favorites.friends[account.platformUserId] ?? [])
              : []
          )
      )
      if (held.size === 0) continue
      // The account's own group order decides, not the order the keys came in.
      const first = favorites.groups.friend.find((group) => held.has(group.key))
      const home = first === undefined ? undefined : parts.get(`${platform}:${first.key}`)
      if (home !== undefined) return home
    }
    return undefined
  }

  for (const row of rows) {
    // A linked person sits under a group of the account they are in the game
    // on, so the heading never names a platform the row is not on right now.
    const inGame = row.accounts.filter((account) => account.presence?.state === 'in-game')
    const home =
      (inGame.length > 0 && inGame.length < row.accounts.length ? homeFor(inGame) : undefined) ??
      homeFor(row.accounts)
    ;(home ?? starred).rows.push(row)
  }

  const filled = [...parts.values(), starred].filter((part) => part.rows.length > 0)
  return filled.length < 2 ? [] : filled
}
