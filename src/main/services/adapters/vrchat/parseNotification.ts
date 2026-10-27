/**
 * VRChat Pipeline notification → inbox entry.
 *
 * The `notification` event carries one Notification object. Only three types
 * reach the inbox: `invite`, `requestInvite` and `friendRequest`. Everything
 * else (responses, votes to kick, messages, group notices) is ignored here.
 * `details` arrives as an object on the Pipeline and as a JSON string over
 * REST; both are read, and anything unreadable just leaves the world unnamed.
 */
import { z } from 'zod'
import {
  INBOX_NAME_MAX_LENGTH,
  INBOX_WORLD_NAME_MAX_LENGTH,
  boundedInboxText,
  isInboxId,
  type InboxEntry,
  type InboxKind
} from '@shared/inbox'

const KIND_BY_TYPE: Readonly<Record<string, InboxKind>> = {
  invite: 'invite',
  requestInvite: 'invite-request',
  friendRequest: 'friend-request'
}

const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  senderUserId: z.string(),
  senderUsername: z.unknown().optional(),
  details: z.unknown().optional()
})

const inviteDetailsSchema = z.object({ worldName: z.unknown().optional() })

function readDetails(details: unknown): unknown {
  if (typeof details !== 'string') return details
  try {
    return JSON.parse(details)
  } catch {
    return null
  }
}

/** One inbox entry, or null for an unrelated or malformed notification. */
export function parseVrcNotification(content: unknown): InboxEntry | null {
  const parsed = notificationSchema.safeParse(content)
  if (!parsed.success) return null
  const { id, type, senderUserId, senderUsername, details } = parsed.data
  const kind = Object.hasOwn(KIND_BY_TYPE, type) ? KIND_BY_TYPE[type] : undefined
  if (kind === undefined || !isInboxId(id) || !isInboxId(senderUserId)) return null
  const worldName =
    kind === 'invite'
      ? boundedInboxText(
          inviteDetailsSchema.safeParse(readDetails(details)).data?.worldName,
          INBOX_WORLD_NAME_MAX_LENGTH
        )
      : null
  return {
    sourceId: id,
    kind,
    senderId: senderUserId,
    senderName: boundedInboxText(senderUsername, INBOX_NAME_MAX_LENGTH),
    worldName
  }
}

const responseSchema = z.object({ notificationId: z.string() })

/**
 * The notification ID a `hide-notification`, `see-notification` or
 * `response-notification` refers to. Hide and see carry the bare ID; a
 * response names it as `notificationId`.
 */
export function notificationIdOf(content: unknown): string | null {
  if (isInboxId(content)) return content
  const response = responseSchema.safeParse(content)
  return response.success && isInboxId(response.data.notificationId)
    ? response.data.notificationId
    : null
}
