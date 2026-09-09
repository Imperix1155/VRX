import type {
  ExploreCount,
  ExploreJoinDenial,
  ExplorePublicAccess,
  ExploreRoom,
  ExploreWorld
} from '@shared/explore'

export type VrcExploreWorldEvidence = Omit<ExploreWorld, 'worldRef'>
export interface VrcExploreRoomEvidence extends Omit<ExploreRoom, 'action'> {
  joinEligibility: 'eligible' | ExploreJoinDenial
}
export interface VrcExploreWorldDetail {
  world: VrcExploreWorldEvidence
  roomIds: string[]
  /** Per-room tuple counts never replace the world's aggregate `occupants` count. */
  roomCounts: Array<{ roomId: string; occupancy: ExploreCount }>
  roomsComplete: boolean
}

type RecordValue = Record<string, unknown>

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const WORLD_ID = new RegExp(`^wrld_${UUID}$`, 'i')
const GROUP_ID = new RegExp(`^grp_${UUID}$`, 'i')

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function count(
  value: number | null,
  source: ExploreCount['source'],
  state: 'complete' | 'partial' | 'unknown' = 'complete'
): ExploreCount {
  return value !== null && state === 'complete'
    ? { state, value, source }
    : { state: state === 'partial' ? 'partial' : 'unknown', value: null, source }
}

function validWorldId(value: unknown): value is string {
  return typeof value === 'string' && WORLD_ID.test(value)
}

function parseVrcRoomResponseAccess(raw: RecordValue): ExplorePublicAccess | null {
  if (!Object.hasOwn(raw, 'type') || typeof raw.type !== 'string') return null
  if (raw.type === 'public') {
    return !Object.hasOwn(raw, 'groupAccessType') || raw.groupAccessType === null ? 'public' : null
  }
  if (
    raw.type === 'group' &&
    Object.hasOwn(raw, 'groupAccessType') &&
    raw.groupAccessType === 'public'
  ) {
    return 'group-public'
  }
  return null
}

/**
 * Distinguishes documented access from failed qualification. Known non-public
 * rooms are excluded; unknown/malformed identifiers leave coverage incomplete.
 * The permissive friend-location parser intentionally does not apply here.
 */
function classifyVrcExploreAccess(instanceId: unknown): ExplorePublicAccess | 'excluded' | null {
  if (typeof instanceId !== 'string' || instanceId.length === 0 || instanceId.length > 1024)
    return null
  const parts = instanceId.split('~')
  const base = parts.shift()
  if (
    !base ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(base) ||
    ['offline', 'private', 'traveling', '__proto__', 'constructor', 'prototype'].includes(base)
  )
    return null

  let group = false
  let groupAccess: 'public' | 'plus' | 'members' | null = null
  let ownerAccess: 'hidden' | 'friends' | 'private' | null = null
  let canRequestInvite = false
  const seen = new Set<string>()
  for (const modifier of parts) {
    const match = /^([A-Za-z]+)(?:\(([A-Za-z0-9_-]{1,160})\))?$/.exec(modifier)
    if (!match) return null
    const [, key, tagValue = ''] = match
    if (!key) return null
    if (seen.has(key)) return null
    seen.add(key)
    if (
      ![
        'group',
        'groupAccessType',
        'region',
        'nonce',
        'ageGate',
        'hidden',
        'friends',
        'private',
        'canRequestInvite'
      ].includes(key)
    )
      return null
    if (key === 'region' && !['us', 'use', 'usw', 'eu', 'jp'].includes(tagValue)) return null
    if (key === 'nonce' && !tagValue) return null
    if (key === 'ageGate' && tagValue !== '' && tagValue !== 'true' && tagValue !== 'false')
      return null
    if (key === 'group') {
      if (!GROUP_ID.test(tagValue)) return null
      group = true
    }
    if (key === 'groupAccessType') {
      if (tagValue !== 'public' && tagValue !== 'plus' && tagValue !== 'members') return null
      groupAccess = tagValue
    }
    if (key === 'hidden' || key === 'friends' || key === 'private') {
      if (!tagValue || ownerAccess !== null) return null
      ownerAccess = key
    }
    if (key === 'canRequestInvite') {
      if (tagValue !== '') return null
      canRequestInvite = true
    }
  }
  if (ownerAccess !== null) {
    if (group || groupAccess !== null || (canRequestInvite && ownerAccess !== 'private'))
      return null
    return 'excluded'
  }
  if (canRequestInvite) return null
  if (group) {
    if (groupAccess === 'public') return 'group-public'
    return groupAccess === 'plus' || groupAccess === 'members' ? 'excluded' : null
  }
  return groupAccess === null ? 'public' : null
}

/** Unknown identifiers and known non-public access both stay outside public discovery. */
export function parseVrcExplorePublicAccess(instanceId: unknown): ExplorePublicAccess | null {
  const access = classifyVrcExploreAccess(instanceId)
  return access === 'excluded' ? null : access
}

function expectedAgeGated(instanceId: string): boolean {
  return instanceId.split('~').some((tag) => tag === 'ageGate' || tag === 'ageGate(true)')
}

function parseCandidate(value: unknown, sourceOrder: number): VrcExploreWorldEvidence | null {
  const raw = record(value)
  if (!raw || !Object.hasOwn(raw, 'id') || !Object.hasOwn(raw, 'name') || !validWorldId(raw.id))
    return null
  const name = text(raw.name)
  if (!name) return null
  const occupants = nonNegativeInteger(raw.occupants)
  return {
    platform: 'vrchat',
    worldId: raw.id,
    name,
    thumbnailUrl: text(raw.thumbnailImageUrl),
    activity: count(occupants, 'vrc-world-occupants', occupants === null ? 'unknown' : 'complete'),
    visibleRoomCount: count(null, 'unknown', 'unknown'),
    popularity:
      typeof raw.popularity === 'number' && Number.isFinite(raw.popularity) ? raw.popularity : null,
    sourceOrder
  }
}

/** Parses one bounded active-world response. Invalid entries are omitted. */
export function parseVrcExploreCandidates(value: unknown): VrcExploreWorldEvidence[] {
  if (!Array.isArray(value)) return []
  const worlds: VrcExploreWorldEvidence[] = []
  const seen = new Set<string>()
  for (const [sourceOrder, entry] of value.entries()) {
    const world = parseCandidate(entry, sourceOrder)
    if (world && !seen.has(world.worldId)) {
      seen.add(world.worldId)
      worlds.push(world)
    }
  }
  return worlds
}

/** Parses world detail room tuples without retaining their language/member payloads. */
export function parseVrcExploreWorld(
  value: unknown,
  expectedWorldId: string
): VrcExploreWorldDetail | null {
  const raw = record(value)
  if (
    !raw ||
    !Object.hasOwn(raw, 'id') ||
    !Object.hasOwn(raw, 'name') ||
    !Object.hasOwn(raw, 'instances') ||
    !validWorldId(expectedWorldId) ||
    raw.id !== expectedWorldId
  ) {
    return null
  }
  const name = text(raw.name)
  if (!name || !Array.isArray(raw.instances)) return null

  const roomIds: string[] = []
  const seen = new Set<string>()
  const roomCounts: Array<{ roomId: string; occupancy: ExploreCount }> = []
  let complete = true
  for (const tuple of raw.instances) {
    if (!Array.isArray(tuple) || tuple.length !== 3 || typeof tuple[0] !== 'string') {
      complete = false
      continue
    }
    const access = classifyVrcExploreAccess(tuple[0])
    const users = nonNegativeInteger(tuple[1])
    if (!record(tuple[2])) {
      complete = false
      continue
    }
    // Known non-public rooms are excluded; failed qualification is incomplete evidence.
    if (access === null) {
      complete = false
      continue
    }
    if (access === 'excluded' || seen.has(tuple[0])) continue
    seen.add(tuple[0])
    roomIds.push(tuple[0])
    roomCounts.push({
      roomId: tuple[0],
      occupancy: count(users, 'vrc-world-tuple')
    })
  }
  const occupants = nonNegativeInteger(raw.occupants)
  return {
    world: {
      platform: 'vrchat',
      worldId: expectedWorldId,
      name,
      thumbnailUrl: text(raw.thumbnailImageUrl),
      activity: count(
        occupants,
        'vrc-world-occupants',
        occupants === null ? 'unknown' : 'complete'
      ),
      visibleRoomCount: complete
        ? count(roomIds.length, 'visible-rooms')
        : count(null, 'visible-rooms', 'partial'),
      popularity:
        typeof raw.popularity === 'number' && Number.isFinite(raw.popularity)
          ? raw.popularity
          : null,
      sourceOrder: 0
    },
    roomIds,
    roomCounts,
    roomsComplete: complete
  }
}

/** Parses one room response and proves identity and every VRC action prerequisite. */
export function parseVrcExploreRoom(
  value: unknown,
  expectedWorldId: string,
  expectedRoomId: string
): VrcExploreRoomEvidence | null {
  const raw = record(value)
  const access = parseVrcExplorePublicAccess(expectedRoomId)
  if (
    !raw ||
    !Object.hasOwn(raw, 'worldId') ||
    !Object.hasOwn(raw, 'instanceId') ||
    !access ||
    !validWorldId(expectedWorldId) ||
    raw.worldId !== expectedWorldId ||
    raw.instanceId !== expectedRoomId
  ) {
    return null
  }
  const qualifiedId = `${expectedWorldId}:${expectedRoomId}`
  if (Object.hasOwn(raw, 'id') && raw.id !== expectedRoomId && raw.id !== qualifiedId) return null
  if (Object.hasOwn(raw, 'location') && raw.location !== qualifiedId) return null
  const nUsers = nonNegativeInteger(raw.n_users)
  const userCount = nonNegativeInteger(raw.userCount)
  const occupancy =
    nUsers !== null
      ? count(nUsers, 'vrc-room-n-users')
      : userCount !== null
        ? count(userCount, 'vrc-room-user-count')
        : count(null, 'unknown', 'unknown')
  const capacity = nonNegativeInteger(raw.capacity)
  const responseAccess = parseVrcRoomResponseAccess(raw)
  const eligible =
    responseAccess === access &&
    !expectedAgeGated(expectedRoomId) &&
    [
      'active',
      'full',
      'hasCapacityForYou',
      'roleRestricted',
      'ageGate',
      'closedAt',
      'hardClose'
    ].every((key) => Object.hasOwn(raw, key)) &&
    raw.active === true &&
    raw.full === false &&
    raw.hasCapacityForYou === true &&
    raw.roleRestricted === false &&
    raw.ageGate === false &&
    raw.closedAt === null &&
    raw.hardClose === null
  const joinEligibility: 'eligible' | ExploreJoinDenial = eligible
    ? 'eligible'
    : raw.full === true
      ? 'full'
      : raw.roleRestricted === true || raw.ageGate === true
        ? 'restricted'
        : raw.active === false || raw.closedAt !== null || raw.hardClose !== null
          ? 'unavailable'
          : 'unknown'
  return {
    platform: 'vrchat',
    worldId: expectedWorldId,
    roomId: expectedRoomId,
    access,
    region: text(raw.region),
    groupName: text(raw.groupName),
    occupancy,
    capacity,
    full: typeof raw.full === 'boolean' ? raw.full : null,
    joinEligibility
  }
}
