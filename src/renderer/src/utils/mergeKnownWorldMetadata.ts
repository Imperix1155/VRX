/**
 * Cold-start roster merge helper (VRX-258).
 *
 * When the renderer launches it hydrates a persisted friends cache that already
 * knows world names. The first REST `getFriends()` refetch arrives while the
 * main-side WorldResolver is still cold, so VRChat's friends wire carries
 * `worldName: null` for every in-world friend. This helper is the renderer-side
 * sibling of VrcAdapter's `enrichPipelineEvent` clobber guard (VRX-254): it lets
 * already-known names survive the REST roster write, but only when the friend is
 * still in the same world.
 *
 * For each fresh friend with a non-null instance: look up the cached friend by
 * composite `platform:platformUserId`. If the cached friend has a non-null
 * instance and `cached.instance.worldId === fresh.instance.worldId` (strict
 * equality — a friend who actually moved worlds must NEVER inherit the old
 * world's name), fill each of `worldName` / `thumbnailUrl` independently only
 * where the fresh value is null and the cached value is non-null. Everything
 * else on the fresh friend is untouched; fresh wins. Friends with `instance:
 * null` pass through untouched (no resurrection), and cached friends absent from
 * fresh are never inserted.
 *
 * Reference identity is load-bearing: `FriendRow` is memo'd on Friend identity,
 * so a friend needing no fill must be returned as the same object, and a wholly
 * no-op merge returns the `fresh` array itself.
 */
import type { Friend } from '@shared/types'

export function mergeKnownWorldMetadata(cached: Friend[] | undefined, fresh: Friend[]): Friend[] {
  if (!cached || cached.length === 0) return fresh

  const byKey = new Map(cached.map((f) => [`${f.platform}:${f.platformUserId}`, f]))
  let changed = false
  const next = fresh.map((friend): Friend => {
    const freshInstance = friend.instance
    if (freshInstance === null) return friend

    const cachedFriend = byKey.get(`${friend.platform}:${friend.platformUserId}`)
    if (!cachedFriend) return friend

    const cachedInstance = cachedFriend.instance
    if (cachedInstance === null || cachedInstance.worldId !== freshInstance.worldId) return friend

    let mergedInstance = freshInstance
    if (freshInstance.worldName === null && cachedInstance.worldName !== null) {
      mergedInstance = { ...mergedInstance, worldName: cachedInstance.worldName }
    }
    if (freshInstance.thumbnailUrl === null && cachedInstance.thumbnailUrl !== null) {
      mergedInstance = { ...mergedInstance, thumbnailUrl: cachedInstance.thumbnailUrl }
    }

    if (mergedInstance === freshInstance) return friend

    changed = true
    return { ...friend, instance: mergedInstance }
  })

  return changed ? next : fresh
}
