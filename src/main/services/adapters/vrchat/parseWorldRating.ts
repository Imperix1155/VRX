import { isWorldRatingValue, type WorldRating } from '@shared/worldRating'

export type ParsedWorldRating = { ok: true; value: WorldRating } | { ok: false }

/**
 * `GET`, `PUT` and `DELETE /worlds/{worldId}/rating` all answer
 * `{ value: "like" | "dislike" | null }`. Anything else is unusable.
 * Extra fields are ignored; a missing or unknown `value` is refused.
 */
export function parseWorldRatingBody(value: unknown): ParsedWorldRating {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  if (!Object.hasOwn(value, 'value')) return { ok: false }
  const rating = (value as { value: unknown }).value
  if (rating === null) return { ok: true, value: null }
  if (isWorldRatingValue(rating)) return { ok: true, value: rating }
  return { ok: false }
}
