/**
 * ChilloutVR `/users/ws` invite and request frames → inbox entries.
 *
 * 🟡 Shapes follow CVRX and chilloutvr_rs and are not yet confirmed on the live
 * wire, so both casings are read, like ONLINE_FRIENDS (PascalCase was observed
 * there):
 * - `15` INVITES: `[{ Id, User: { Id, Name }, World: { Name }, InstanceName }]`
 * - `20` REQUEST_INVITES: `[{ Id, Sender: { Id, Name } }]`
 * - `25` FRIEND_REQUESTS: `[{ Id, Name }]`, the requesting user
 *
 * A single object is read as a one-item list. Records that fail validation are
 * skipped and the rest survive; a frame never removes anything, because it is
 * unconfirmed whether a frame lists everything still open.
 */
import {
  INBOX_NAME_MAX_LENGTH,
  INBOX_WORLD_NAME_MAX_LENGTH,
  MAX_INBOX_ENTRIES_PER_FRAME,
  boundedInboxText,
  isInboxId,
  type InboxEntry,
  type InboxKind
} from '@shared/inbox'
import { extractCvrPlatformUserId } from './cvrPlatformUserId'

type WireRecord = Record<string, unknown>

function isRecord(value: unknown): value is WireRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read `Pascal` or `camel`, own properties only. */
function field(record: WireRecord, pascal: string): unknown {
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1)
  if (Object.hasOwn(record, pascal)) return record[pascal]
  if (Object.hasOwn(record, camel)) return record[camel]
  return undefined
}

function userIdOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const result = extractCvrPlatformUserId(value)
  return result.ok ? result.platformUserId : null
}

/** `World (#123)` → `World`, matching how instance names show elsewhere. */
const INSTANCE_SUFFIX = /\s*\(#[^)]*\)\s*$/

function parseRecord(kind: InboxKind, record: WireRecord): InboxEntry | null {
  if (kind === 'friend-request') {
    const senderId = userIdOf(field(record, 'Id'))
    if (senderId === null) return null
    return {
      sourceId: senderId,
      kind,
      senderId,
      senderName: boundedInboxText(field(record, 'Name'), INBOX_NAME_MAX_LENGTH),
      worldName: null
    }
  }

  const sourceId = field(record, 'Id')
  const sender = field(record, kind === 'invite' ? 'User' : 'Sender')
  if (!isInboxId(sourceId) || !isRecord(sender)) return null
  const senderId = userIdOf(field(sender, 'Id'))
  if (senderId === null) return null

  let worldName: string | null = null
  if (kind === 'invite') {
    const world = field(record, 'World')
    const instanceName = field(record, 'InstanceName')
    worldName =
      boundedInboxText(
        isRecord(world) ? field(world, 'Name') : null,
        INBOX_WORLD_NAME_MAX_LENGTH
      ) ??
      boundedInboxText(
        typeof instanceName === 'string' ? instanceName.replace(INSTANCE_SUFFIX, '') : null,
        INBOX_WORLD_NAME_MAX_LENGTH
      )
  }
  return {
    sourceId,
    kind,
    senderId,
    senderName: boundedInboxText(field(sender, 'Name'), INBOX_NAME_MAX_LENGTH),
    worldName
  }
}

export interface CvrInboxParse {
  entries: InboxEntry[]
  skipped: number
}

/** Every readable record in one frame, at most {@link MAX_INBOX_ENTRIES_PER_FRAME}. */
export function parseCvrInboxFrame(kind: InboxKind, payload: unknown): CvrInboxParse {
  const records = Array.isArray(payload) ? payload : isRecord(payload) ? [payload] : []
  const entries: InboxEntry[] = []
  let skipped = 0
  for (const raw of records.slice(0, MAX_INBOX_ENTRIES_PER_FRAME)) {
    const entry = isRecord(raw) ? parseRecord(kind, raw) : null
    if (entry === null) skipped++
    else entries.push(entry)
  }
  return { entries, skipped }
}
