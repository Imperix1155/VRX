import { describe, expect, it } from 'vitest'
import {
  parseCvrExploreCandidates,
  aggregateCvrExploreQualifiedRooms,
  parseCvrExplorePublicAccess,
  parseCvrExploreRoom,
  parseCvrExploreWorld
} from './parseExplore'

const worldId = '11111111-1111-1111-1111-111111111111'
const roomId = 'i+1111111111111111-111111-111111-11111111'

describe('ChilloutVR Explore parsers', () => {
  it('treats categories as candidates only, even when category playerCount is supplied', () => {
    const result = parseCvrExploreCandidates({
      entries: [
        { id: worldId, name: 'Synthetic world', playerCount: 900 },
        { id: worldId, name: 'duplicate' },
        { id: '', name: 'bad' },
        Object.create({ id: 'inherited', name: 'inherited' })
      ]
    })
    expect(result).toEqual([
      expect.objectContaining({
        worldId,
        activity: { state: 'unknown', value: null, source: 'unknown' },
        sourceOrder: 0
      })
    ])
  })

  it('recognizes only exact known public strings, case-insensitively', () => {
    expect(parseCvrExplorePublicAccess('PUBLIC')).toBe('public')
    expect(parseCvrExplorePublicAccess('GroupPublic')).toBe('group-public')
    expect(parseCvrExplorePublicAccess('group-public')).toBeNull()
    expect(parseCvrExplorePublicAccess(' Public')).toBeNull()
    expect(parseCvrExplorePublicAccess(0)).toBeNull()
    expect(parseCvrExplorePublicAccess('constructor')).toBeNull()
  })

  it('deduplicates room IDs and marks incomplete enumeration partial', () => {
    expect(
      parseCvrExploreWorld(
        {
          id: worldId,
          name: 'Synthetic world',
          instances: [{ id: roomId }, { id: roomId }, { nope: true }]
        },
        worldId
      )
    ).toEqual({
      world: expect.objectContaining({
        activity: { state: 'unknown', value: null, source: 'cvr-public-rooms' },
        visibleRoomCount: { state: 'unknown', value: null, source: 'visible-rooms' }
      }),
      roomIds: [roomId],
      roomsComplete: false
    })
    expect(parseCvrExploreWorld({ id: 'other', name: 'wrong', instances: [] }, worldId)).toBeNull()
  })

  it('requires explicit matching known privacy fields before public promotion', () => {
    const base = { id: roomId, world: { id: worldId }, currentPlayerCount: 7, maxPlayer: 7 }
    expect(
      parseCvrExploreRoom(
        { ...base, instanceSettingPrivacy: 'Public', privacy: 'PUBLIC' },
        worldId,
        roomId
      )
    ).toEqual(
      expect.objectContaining({
        access: 'public',
        occupancy: { state: 'complete', value: 7, source: 'cvr-room-current-player-count' },
        capacity: 7,
        joinEligibility: 'eligible'
      })
    )
    expect(
      parseCvrExploreRoom(
        { ...base, instanceSettingPrivacy: 'Public', privacy: 'GroupPublic' },
        worldId,
        roomId
      )
    ).toBeNull()
    expect(
      parseCvrExploreRoom(
        { ...base, instanceSettingPrivacy: 'Public', privacy: 0 },
        worldId,
        roomId
      )
    ).toBeNull()
    expect(parseCvrExploreRoom({ ...base, instanceSettingPrivacy: 0 }, worldId, roomId)).toBeNull()
    expect(parseCvrExploreRoom({ ...base, privacy: 'GroupPublic' }, worldId, roomId)?.access).toBe(
      'group-public'
    )
    expect(
      parseCvrExploreRoom({ ...base, privacy: 'Public', id: 'other' }, worldId, roomId)
    ).toBeNull()
  })

  it('keeps a qualifying full room eligible and marks missing room counts unknown', () => {
    expect(
      parseCvrExploreRoom(
        {
          id: roomId,
          world: { id: worldId },
          privacy: 'Public',
          currentPlayerCount: undefined,
          maxPlayer: 0,
          full: true
        },
        worldId,
        roomId
      )
    ).toEqual(
      expect.objectContaining({
        occupancy: { state: 'unknown', value: null, source: 'unknown' },
        joinEligibility: 'eligible'
      })
    )
  })

  it('aggregates unique qualifying room counts only with complete coverage', () => {
    const publicRoom = parseCvrExploreRoom(
      { id: roomId, world: { id: worldId }, privacy: 'Public', currentPlayerCount: 5 },
      worldId,
      roomId
    )!
    const groupRoom = parseCvrExploreRoom(
      {
        id: 'i+2222222222222222-222222-222222-22222222',
        world: { id: worldId },
        privacy: 'GroupPublic',
        currentPlayerCount: 3
      },
      worldId,
      'i+2222222222222222-222222-222222-22222222'
    )!
    expect(
      aggregateCvrExploreQualifiedRooms(worldId, [publicRoom, groupRoom, publicRoom], true)
    ).toEqual({
      state: 'complete',
      value: 8,
      source: 'cvr-public-rooms'
    })
    expect(aggregateCvrExploreQualifiedRooms(worldId, [publicRoom], false)).toEqual({
      state: 'partial',
      value: null,
      source: 'cvr-public-rooms'
    })
    expect(
      aggregateCvrExploreQualifiedRooms(
        worldId,
        [{ ...publicRoom, occupancy: { state: 'unknown', value: null, source: 'unknown' } }],
        true
      )
    ).toEqual({ state: 'partial', value: null, source: 'cvr-public-rooms' })
    expect(aggregateCvrExploreQualifiedRooms(worldId, [], true)).toEqual({
      state: 'unknown',
      value: null,
      source: 'cvr-public-rooms'
    })
    expect(
      aggregateCvrExploreQualifiedRooms(
        worldId,
        [
          {
            ...publicRoom,
            occupancy: {
              state: 'complete',
              value: Number.MAX_SAFE_INTEGER,
              source: 'cvr-room-current-player-count'
            }
          },
          {
            ...groupRoom,
            occupancy: { state: 'complete', value: 1, source: 'cvr-room-current-player-count' }
          }
        ],
        true
      )
    ).toEqual({ state: 'partial', value: null, source: 'cvr-public-rooms' })
  })

  it('never combines another world or unverified, negative, or unsafe counts into public totals', () => {
    const current = parseCvrExploreRoom(
      { id: roomId, world: { id: worldId }, privacy: 'Public', currentPlayerCount: 5 },
      worldId,
      roomId
    )!
    const otherRoomId = 'i+2222222222222222-222222-222222-22222222'
    const invalid = [
      { ...current, worldId: '22222222-2222-2222-2222-222222222222' },
      {
        ...current,
        occupancy: { state: 'complete' as const, value: 90, source: 'vrc-world-occupants' as const }
      },
      {
        ...current,
        occupancy: {
          state: 'complete' as const,
          value: -2,
          source: 'cvr-room-current-player-count' as const
        }
      },
      {
        ...current,
        occupancy: {
          state: 'complete' as const,
          value: Number.MAX_SAFE_INTEGER + 1,
          source: 'cvr-room-current-player-count' as const
        }
      }
    ]
    for (const room of invalid) {
      expect(
        aggregateCvrExploreQualifiedRooms(
          worldId,
          [current, { ...room, roomId: otherRoomId }],
          true
        )
      ).toEqual({ state: 'partial', value: null, source: 'cvr-public-rooms' })
    }
  })

  it('keeps public room counts unknown until access qualification and ignores duplicate enumeration', () => {
    const world = parseCvrExploreWorld(
      { id: worldId, name: 'World', instances: [{ id: roomId }, { id: roomId }] },
      worldId
    )!
    expect(world.roomsComplete).toBe(true)
    expect(world.roomIds).toEqual([roomId])
    expect(world.world.visibleRoomCount.value).toBeNull()
  })
})
