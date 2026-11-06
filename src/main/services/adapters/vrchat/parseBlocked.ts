/** Most player moderation records read from one reply. */
const MAX_MODERATIONS = 5_000

/**
 * `GET /auth/user/playermoderations?type=block&targetUserId=…`: whether any
 * record is a block of exactly that person. The filter is asked for, but the
 * records are checked anyway so a reply that ignores it cannot mislead.
 * Returns null when the reply is not a list.
 */
export function parseVrcBlocked(value: unknown, userId: string): boolean | null {
  if (!Array.isArray(value)) return null
  return value.slice(0, MAX_MODERATIONS).some((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
    const record = entry as Record<string, unknown>
    return record.type === 'block' && record.targetUserId === userId
  })
}
