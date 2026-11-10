/** Most player moderation records read from one reply. */
export const MAX_MODERATIONS = 20_000

/** The people the signed-in user blocks, from one moderation list. */
export interface VrcBlockList {
  ids: ReadonlySet<string>
  /** False when the reply held more records than VRX reads, so a missing id is unknown. */
  complete: boolean
}

/**
 * `GET /auth/user/playermoderations`, asked for the way VRCX asks: no filter,
 * every moderation the user made (mutes, blocks, interaction toggles). Only
 * records whose `type` is `block` count. Returns null when the reply is not a
 * list.
 */
export function parseVrcBlockList(value: unknown): VrcBlockList | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  for (const entry of value.slice(0, MAX_MODERATIONS)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (record.type === 'block' && typeof record.targetUserId === 'string') {
      ids.add(record.targetUserId)
    }
  }
  return { ids, complete: value.length <= MAX_MODERATIONS }
}

/** Whether the list blocks exactly that person; null when a cut-off list does not say. */
export function isVrcBlocked(list: VrcBlockList, userId: string): boolean | null {
  if (list.ids.has(userId)) return true
  return list.complete ? false : null
}
