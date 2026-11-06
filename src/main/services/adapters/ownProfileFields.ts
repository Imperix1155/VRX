import { COMMUNITY_TEXT_MAX_LENGTH } from '@shared/community'

/**
 * One own-profile text field. A string is kept (trimmed, bounded); null or a
 * missing field means the user has none. Any other type makes the whole
 * reply unreadable (`undefined`), so a changed format is never shown as an
 * empty bio the user might then save over.
 */
export function ownText(value: unknown): string | undefined {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > COMMUNITY_TEXT_MAX_LENGTH
    ? trimmed.slice(0, COMMUNITY_TEXT_MAX_LENGTH)
    : trimmed
}
