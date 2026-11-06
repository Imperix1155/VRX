import { AVATAR_IMAGE_URL_MAX_LENGTH, AVATAR_TEXT_MAX_LENGTH } from '@shared/avatarLibrary'

export type RecordValue = Record<string, unknown>

/** Field readers shared by the VRChat and ChilloutVR avatar parsers. */
export function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null
}

/** Trimmed, bounded text; empty strings ("" = unset on both platforms) become null. */
export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.length > AVATAR_TEXT_MAX_LENGTH
    ? trimmed.slice(0, AVATAR_TEXT_MAX_LENGTH)
    : trimmed
}

/** An HTTPS URL short enough for the image proxy, else null. The proxy still checks the host. */
export function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > AVATAR_IMAGE_URL_MAX_LENGTH) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/** A readable date as ISO 8601, else null. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** Newest change first; avatars without a date keep their reply order at the end. */
export function byNewestChange<T extends { updatedAt: string | null; createdAt: string | null }>(
  items: T[]
): T[] {
  const stamp = (item: T): number => Date.parse(item.updatedAt ?? item.createdAt ?? '') || 0
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => stamp(b.item) - stamp(a.item) || a.index - b.index)
    .map(({ item }) => item)
}
