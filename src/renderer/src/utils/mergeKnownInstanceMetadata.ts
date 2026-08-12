/**
 * Cold-start roster merge helper (VRX-258 / VRX-260).
 *
 * When the renderer launches it hydrates a persisted friends cache that already
 * knows world and group names/images. The first REST `getFriends()` refetch
 * arrives while the main-side WorldResolver / GroupResolver is still cold, so
 * VRChat's friends wire carries `worldName: null` and `groupName: null` for
 * every in-world friend. This helper is the renderer-side sibling of
 * VrcAdapter's `enrichPipelineEvent` clobber guard (VRX-254): it lets
 * already-known names/images survive the REST roster write, but only when the
 * friend is still in the same world/group.
 *
 * For each fresh friend with a non-null instance: look up the cached friend by
 * composite `platform:platformUserId`. If the cached friend has a non-null
 * instance and the identity matches (strict `worldId` equality for world
 * fields, strict `groupId` equality for group fields), fill each enrichment
 * field independently only where the fresh value is null and the cached value
 * is non-null. Everything else on the fresh friend is untouched; fresh wins.
 * A friend who actually moved worlds must NEVER inherit the old world's name,
 * and a friend whose group changed must NEVER inherit the old group's name.
 * Friends with `instance: null` pass through untouched (no resurrection), and
 * cached friends absent from fresh are never inserted.
 *
 * Reference identity is load-bearing: `FriendRow` is memo'd on Friend identity,
 * so a friend needing no fill must be returned as the same object, and a wholly
 * no-op merge returns the `fresh` array itself.
 */
import type { Friend } from '@shared/types'

export function mergeKnownInstanceMetadata(
  cached: Friend[] | undefined,
  fresh: Friend[]
): Friend[] {
  if (!cached || cached.length === 0) return fresh

  const byKey = new Map(cached.map((f) => [`${f.platform}:${f.platformUserId}`, f]))
  let changed = false
  const next = fresh.map((friend): Friend => {
    const freshInstance = friend.instance
    if (freshInstance === null) return friend

    const cachedFriend = byKey.get(`${friend.platform}:${friend.platformUserId}`)
    if (!cachedFriend) return friend

    const cachedInstance = cachedFriend.instance
    if (cachedInstance === null) return friend

    let mergedInstance = freshInstance

    // World enrichment: same world only.
    if (cachedInstance.worldId === freshInstance.worldId) {
      if (freshInstance.worldName === null && cachedInstance.worldName !== null) {
        mergedInstance = { ...mergedInstance, worldName: cachedInstance.worldName }
      }
      if (freshInstance.thumbnailUrl === null && cachedInstance.thumbnailUrl !== null) {
        mergedInstance = { ...mergedInstance, thumbnailUrl: cachedInstance.thumbnailUrl }
      }
    }

    // Group enrichment: same group only (both non-null, strict equality).
    if (
      freshInstance.groupId !== null &&
      cachedInstance.groupId !== null &&
      cachedInstance.groupId === freshInstance.groupId
    ) {
      if (freshInstance.groupName === null && cachedInstance.groupName !== null) {
        mergedInstance = { ...mergedInstance, groupName: cachedInstance.groupName }
      }
      if (freshInstance.groupImageUrl === null && cachedInstance.groupImageUrl !== null) {
        mergedInstance = { ...mergedInstance, groupImageUrl: cachedInstance.groupImageUrl }
      }
    }

    if (mergedInstance === freshInstance) return friend

    changed = true
    return { ...friend, instance: mergedInstance }
  })

  return changed ? next : fresh
}
