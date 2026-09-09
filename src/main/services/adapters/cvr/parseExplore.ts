import type {
  ExploreCount,
  ExploreJoinDenial,
  ExplorePublicAccess,
  ExploreRoom,
  ExploreWorld
} from '@shared/explore'

export type CvrExploreWorldEvidence = Omit<ExploreWorld, 'worldRef'>
export interface CvrExploreRoomEvidence extends Omit<ExploreRoom, 'action'> {
  joinEligibility: 'eligible' | ExploreJoinDenial
}
export interface CvrExploreWorldDetail {
  world: CvrExploreWorldEvidence
  roomIds: string[]
  roomsComplete: boolean
}

type RecordValue = Record<string, unknown>
const CVR_WORLD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CVR_ROOM_ID = /^i\+[0-9a-f]{16}-[0-9a-f]{6}-[0-9a-f]{6}-[0-9a-f]{8}$/i

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function worldId(value: unknown): value is string {
  return typeof value === 'string' && CVR_WORLD_ID.test(value)
}

function roomId(value: unknown): value is string {
  return typeof value === 'string' && CVR_ROOM_ID.test(value)
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function unknown(source: ExploreCount['source'] = 'unknown'): ExploreCount {
  return { state: 'unknown', value: null, source }
}

/** Exact known discovery privacy strings. Punctuation and whitespace stay meaningful. */
export function parseCvrExplorePublicAccess(value: unknown): ExplorePublicAccess | null {
  if (typeof value !== 'string') return null
  switch (value.toLowerCase()) {
    case 'public':
      return 'public'
    case 'grouppublic':
      return 'group-public'
    default:
      return null
  }
}

function parseCandidate(value: unknown, sourceOrder: number): CvrExploreWorldEvidence | null {
  const raw = record(value)
  if (!raw || !Object.hasOwn(raw, 'id') || !Object.hasOwn(raw, 'name') || !worldId(raw.id))
    return null
  const name = text(raw.name)
  if (!name) return null
  return {
    platform: 'chilloutvr',
    worldId: raw.id,
    name,
    thumbnailUrl: text(raw.imageUrl) ?? text(raw.thumbnailUrl),
    activity: unknown(),
    visibleRoomCount: unknown(),
    popularity: null,
    sourceOrder
  }
}

/** Category data names candidates only. It can never establish public occupancy. */
export function parseCvrExploreCandidates(value: unknown): CvrExploreWorldEvidence[] {
  const listed = record(value)
  const entries =
    listed && Object.hasOwn(listed, 'entries') && Array.isArray(listed.entries)
      ? listed.entries
      : []
  const worlds: CvrExploreWorldEvidence[] = []
  const seen = new Set<string>()
  for (const [sourceOrder, entry] of entries.entries()) {
    const world = parseCandidate(entry, sourceOrder)
    if (world && !seen.has(world.worldId)) {
      seen.add(world.worldId)
      worlds.push(world)
    }
  }
  return worlds
}

/** Parses room IDs from a world response without retaining raw room objects. */
export function parseCvrExploreWorld(
  value: unknown,
  expectedWorldId: string
): CvrExploreWorldDetail | null {
  const raw = record(value)
  if (
    !raw ||
    !Object.hasOwn(raw, 'id') ||
    !Object.hasOwn(raw, 'name') ||
    !worldId(expectedWorldId) ||
    raw.id !== expectedWorldId
  ) {
    return null
  }
  const name = text(raw.name)
  if (!name) return null
  const rawRooms =
    Object.hasOwn(raw, 'instances') && Array.isArray(raw.instances) ? raw.instances : null
  if (!rawRooms) return null
  const roomIds: string[] = []
  const seen = new Set<string>()
  let complete = true
  for (const entry of rawRooms) {
    const row = record(entry)
    const id = row && Object.hasOwn(row, 'id') ? row.id : null
    if (!roomId(id)) {
      complete = false
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    roomIds.push(id)
  }
  return {
    world: {
      platform: 'chilloutvr',
      worldId: expectedWorldId,
      name,
      thumbnailUrl: text(raw.imageUrl) ?? text(raw.thumbnailUrl),
      activity: unknown('cvr-public-rooms'),
      // Enumeration alone has not qualified any of these rooms as public.
      visibleRoomCount: unknown('visible-rooms'),
      popularity: null,
      sourceOrder: 0
    },
    roomIds,
    roomsComplete: complete
  }
}

/**
 * Room details must contain an exact public privacy string. When both supplied
 * privacy fields exist, both must be known and agree before promotion.
 */
export function parseCvrExploreRoom(
  value: unknown,
  expectedWorldId: string,
  expectedRoomId: string
): CvrExploreRoomEvidence | null {
  const raw = record(value)
  if (
    !raw ||
    !Object.hasOwn(raw, 'id') ||
    !worldId(expectedWorldId) ||
    !roomId(expectedRoomId) ||
    raw.id !== expectedRoomId
  ) {
    return null
  }
  const world = Object.hasOwn(raw, 'world') ? record(raw.world) : null
  if (!world || !Object.hasOwn(world, 'id') || world.id !== expectedWorldId) return null
  const settingProvided = Object.hasOwn(raw, 'instanceSettingPrivacy')
  const privacyProvided = Object.hasOwn(raw, 'privacy')
  const setting = settingProvided ? parseCvrExplorePublicAccess(raw.instanceSettingPrivacy) : null
  const privacy = privacyProvided ? parseCvrExplorePublicAccess(raw.privacy) : null
  const access = settingProvided
    ? setting !== null && (!privacyProvided || privacy === setting)
      ? setting
      : null
    : privacy
  if (!access) return null
  const occupants = nonNegativeInteger(raw.currentPlayerCount)
  return {
    platform: 'chilloutvr',
    worldId: expectedWorldId,
    roomId: expectedRoomId,
    access,
    region: text(raw.region),
    groupName: text(record(raw.group)?.name),
    occupancy:
      occupants === null
        ? unknown()
        : { state: 'complete', value: occupants, source: 'cvr-room-current-player-count' },
    capacity: nonNegativeInteger(raw.maxPlayer),
    full: null,
    // CVR deliberately has no capacity/admission gate. A qualifying full room stays eligible.
    joinEligibility: 'eligible'
  }
}

/**
 * Sums deduplicated, already-qualified current-world rooms. The caller passes
 * false when any room access/detail could not be resolved; no subtotal leaks as
 * a display total in that case.
 */
export function aggregateCvrExploreQualifiedRooms(
  expectedWorldId: string,
  rooms: readonly CvrExploreRoomEvidence[],
  roomsComplete: boolean
): ExploreCount {
  if (!worldId(expectedWorldId)) return unknown('cvr-public-rooms')
  const seen = new Set<string>()
  let total = 0
  let hasQualifiedRoom = false
  let countsComplete = true
  for (const room of rooms) {
    if (
      room.platform !== 'chilloutvr' ||
      room.worldId !== expectedWorldId ||
      !roomId(room.roomId) ||
      (room.access !== 'public' && room.access !== 'group-public')
    ) {
      countsComplete = false
      continue
    }
    if (seen.has(room.roomId)) continue
    seen.add(room.roomId)
    hasQualifiedRoom = true
    if (
      room.occupancy.state !== 'complete' ||
      room.occupancy.source !== 'cvr-room-current-player-count' ||
      nonNegativeInteger(room.occupancy.value) === null
    ) {
      countsComplete = false
      continue
    }
    if (!Number.isSafeInteger(total + room.occupancy.value)) {
      countsComplete = false
      continue
    }
    total += room.occupancy.value
  }
  if (!hasQualifiedRoom) return { state: 'unknown', value: null, source: 'cvr-public-rooms' }
  if (!roomsComplete || !countsComplete) {
    return { state: 'partial', value: null, source: 'cvr-public-rooms' }
  }
  return { state: 'complete', value: total, source: 'cvr-public-rooms' }
}
