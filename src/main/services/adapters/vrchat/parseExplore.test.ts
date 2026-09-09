import { describe, expect, it } from 'vitest'
import {
  parseVrcExploreCandidates,
  parseVrcExplorePublicAccess,
  parseVrcExploreRoom,
  parseVrcExploreWorld
} from './parseExplore'

const worldId = 'wrld_11111111-1111-1111-1111-111111111111'
const publicRoom = 'instance-1~region(us)'
const groupPublicRoom =
  'instance-2~group(grp_22222222-2222-2222-2222-222222222222)~groupAccessType(public)'

describe('VRChat Explore parsers', () => {
  it('keeps active-world occupants and popularity, while dropping malformed and duplicate worlds', () => {
    expect(
      parseVrcExploreCandidates([
        { id: worldId, name: 'Synthetic world', occupants: 12, popularity: 9 },
        { id: worldId, name: 'duplicate', occupants: 99 },
        { id: 'bad', name: 'bad', occupants: 1 },
        { id: 'wrld_missing', occupants: 1 },
        Object.create({ id: 'wrld_inherited', name: 'inherited' })
      ])
    ).toEqual([
      expect.objectContaining({
        worldId,
        activity: { state: 'complete', value: 12, source: 'vrc-world-occupants' },
        popularity: 9,
        sourceOrder: 0
      })
    ])
  })

  it('handles a large bounded candidate response without retaining malformed entries', () => {
    const entries = Array.from({ length: 256 }, (_, index) => ({
      id: `wrld_00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`,
      name: `World ${index}`,
      occupants: index
    }))
    entries.push({ id: 'not-a-world-id', name: 'bad', occupants: 1 })
    const worlds = parseVrcExploreCandidates(entries)
    expect(worlds).toHaveLength(256)
    expect(worlds.at(-1)).toEqual(
      expect.objectContaining({
        worldId: 'wrld_00000000-0000-0000-0000-0000000000ff',
        sourceOrder: 255
      })
    )
  })

  it('accepts only the strict public and Group Public identifier grammar', () => {
    expect(parseVrcExplorePublicAccess(publicRoom)).toBe('public')
    expect(parseVrcExplorePublicAccess(groupPublicRoom)).toBe('group-public')
    expect(parseVrcExplorePublicAccess('instance~group(grp_x)')).toBeNull()
    expect(parseVrcExplorePublicAccess('instance~group(grp_x)~groupAccessType(plus)')).toBeNull()
    expect(parseVrcExplorePublicAccess('instance~private(usr_x)')).toBeNull()
    expect(parseVrcExplorePublicAccess('instance~region(us)~region(eu)')).toBeNull()
    expect(parseVrcExplorePublicAccess('instance~nonce(value)')).toBe('public')
    expect(
      parseVrcExplorePublicAccess('instance~group(grp_x)~group(grp_y)~groupAccessType(public)')
    ).toBeNull()
    expect(parseVrcExplorePublicAccess('__proto__')).toBeNull()
    for (const modifier of [
      'groupAccessType',
      'groupAccessType(plus)',
      'groupAccessType(members)',
      'groupAccessType(public)',
      'groupAccessType(unknown)'
    ]) {
      expect(parseVrcExplorePublicAccess(`instance~${modifier}`)).toBeNull()
    }
  })

  it('keeps aggregate occupants separate from qualifying tuple evidence', () => {
    const result = parseVrcExploreWorld(
      {
        id: worldId,
        name: 'Synthetic world',
        occupants: 40,
        instances: [
          [publicRoom, 4, { english: ['members must not escape'] }],
          [groupPublicRoom, 3, { english: {} }],
          ['instance~private(usr_x)', 8, {}],
          [publicRoom, 4, {}],
          ['broken']
        ]
      },
      worldId
    )
    expect(result).toEqual({
      world: expect.objectContaining({
        activity: { state: 'complete', value: 40, source: 'vrc-world-occupants' },
        visibleRoomCount: { state: 'partial', value: null, source: 'visible-rooms' }
      }),
      roomIds: [publicRoom, groupPublicRoom],
      roomCounts: [
        {
          roomId: publicRoom,
          occupancy: { state: 'complete', value: 4, source: 'vrc-world-tuple' }
        },
        {
          roomId: groupPublicRoom,
          occupancy: { state: 'complete', value: 3, source: 'vrc-world-tuple' }
        }
      ],
      roomsComplete: false
    })
    expect(JSON.stringify(result)).not.toContain('members must not escape')
  })

  it('rejects a world identity mismatch', () => {
    expect(
      parseVrcExploreWorld({ id: 'wrld_other', name: 'wrong', instances: [] }, worldId)
    ).toBeNull()
  })

  it('retains a qualified room identity when its optional tuple count is invalid', () => {
    const result = parseVrcExploreWorld(
      { id: worldId, name: 'World', instances: [[publicRoom, -1, {}]] },
      worldId
    )!
    expect(result.roomIds).toEqual([publicRoom])
    expect(result.roomCounts[0]?.occupancy).toEqual({
      state: 'unknown',
      value: null,
      source: 'vrc-world-tuple'
    })
    expect(result.world.visibleRoomCount.value).toBe(1)
    expect(result.world.activity.value).toBeNull()
  })

  it('does not enable public actions from conflicting group access or inherited eligibility flags', () => {
    const flags = {
      active: true,
      full: false,
      hasCapacityForYou: true,
      roleRestricted: false,
      ageGate: false,
      closedAt: null,
      hardClose: null
    }
    const identity = { worldId, instanceId: publicRoom, type: 'public' }
    expect(
      parseVrcExploreRoom(
        { ...identity, ...flags, groupAccessType: 'members' },
        worldId,
        publicRoom
      )?.joinEligibility
    ).not.toBe('eligible')
    expect(
      parseVrcExploreRoom(Object.assign(Object.create(flags), identity), worldId, publicRoom)
        ?.joinEligibility
    ).not.toBe('eligible')
    expect(
      parseVrcExploreRoom({ ...identity, ...flags, groupAccessType: null }, worldId, publicRoom)
        ?.joinEligibility
    ).toBe('eligible')
  })

  it('excludes non-public and duplicate tuples without calling otherwise valid coverage partial', () => {
    expect(
      parseVrcExploreWorld(
        {
          id: worldId,
          name: 'Synthetic world',
          occupants: 17,
          instances: [
            [publicRoom, 4, {}],
            [publicRoom, 4, {}],
            ['instance~private(usr_x)', 13, {}]
          ]
        },
        worldId
      )
    ).toEqual(
      expect.objectContaining({
        roomIds: [publicRoom],
        roomsComplete: true,
        world: expect.objectContaining({
          activity: { state: 'complete', value: 17, source: 'vrc-world-occupants' }
        })
      })
    )
  })

  it('keeps unknown or contradictory access partial instead of claiming no public rooms', () => {
    for (const id of [
      'room~future(foo)',
      'room~region(us)~region(eu)',
      'room~friends(usr_one)~private(usr_two)',
      'room~canRequestInvite',
      groupPublicRoom.replace('public', 'unknown')
    ]) {
      const result = parseVrcExploreWorld(
        { id: worldId, name: 'World', instances: [[id, 8, {}]] },
        worldId
      )!
      expect(result.roomsComplete).toBe(false)
      expect(result.roomIds).toEqual([])
      expect(result.world.visibleRoomCount).toEqual({
        state: 'partial',
        value: null,
        source: 'visible-rooms'
      })
      expect(parseVrcExplorePublicAccess(id)).toBeNull()
    }
  })

  it('can exclude recognized non-public rooms without losing known public coverage', () => {
    const excluded = [
      'room~hidden(usr_owner)',
      'room~friends(usr_owner)',
      'room~private(usr_owner)',
      'room~private(usr_owner)~canRequestInvite',
      groupPublicRoom.replace('public', 'members'),
      groupPublicRoom.replace('public', 'plus')
    ]
    for (const id of excluded) expect(parseVrcExplorePublicAccess(id)).toBeNull()
    const result = parseVrcExploreWorld(
      {
        id: worldId,
        name: 'World',
        instances: [[publicRoom, 2, {}], ...excluded.map((id) => [id, 8, {}])]
      },
      worldId
    )!
    expect(result.roomsComplete).toBe(true)
    expect(result.roomIds).toEqual([publicRoom])
    expect(result.world.visibleRoomCount.value).toBe(1)
  })

  it('uses n_users before divergent userCount and requires every VRC action field', () => {
    const raw = {
      id: groupPublicRoom,
      instanceId: groupPublicRoom,
      worldId,
      type: 'group',
      groupAccessType: 'public',
      n_users: 25,
      userCount: 22,
      capacity: 50,
      active: true,
      full: false,
      hasCapacityForYou: true,
      roleRestricted: false,
      ageGate: false,
      closedAt: null,
      hardClose: null
    }
    expect(parseVrcExploreRoom(raw, worldId, groupPublicRoom)).toEqual(
      expect.objectContaining({
        occupancy: { state: 'complete', value: 25, source: 'vrc-room-n-users' },
        joinEligibility: 'eligible'
      })
    )
    expect(
      parseVrcExploreRoom({ ...raw, hasCapacityForYou: undefined }, worldId, groupPublicRoom)
    ).toEqual(expect.objectContaining({ joinEligibility: 'unknown' }))
    expect(parseVrcExploreRoom({ ...raw, full: true }, worldId, groupPublicRoom)).toEqual(
      expect.objectContaining({ joinEligibility: 'full' })
    )
    expect(
      parseVrcExploreRoom({ ...raw, id: 'instance-other' }, worldId, groupPublicRoom)
    ).toBeNull()
    expect(parseVrcExploreRoom({ ...raw, type: 'public' }, worldId, groupPublicRoom)).toEqual(
      expect.objectContaining({ joinEligibility: 'unknown' })
    )
    expect(
      parseVrcExploreRoom({ ...raw, groupAccessType: undefined }, worldId, groupPublicRoom)
    ).toEqual(expect.objectContaining({ joinEligibility: 'unknown' }))
  })

  it('falls back to userCount only when n_users is invalid, otherwise exposes unknown', () => {
    const shared = {
      id: publicRoom,
      instanceId: publicRoom,
      type: 'public',
      worldId,
      active: true,
      full: false,
      hasCapacityForYou: true,
      roleRestricted: false,
      ageGate: false,
      closedAt: null,
      hardClose: null
    }
    expect(
      parseVrcExploreRoom({ ...shared, n_users: -1, userCount: 22 }, worldId, publicRoom)?.occupancy
    ).toEqual({
      state: 'complete',
      value: 22,
      source: 'vrc-room-user-count'
    })
    expect(parseVrcExploreRoom(shared, worldId, publicRoom)?.occupancy).toEqual({
      state: 'unknown',
      value: null,
      source: 'unknown'
    })
  })

  it('rejects unsafe numeric counts rather than exposing a lossy total', () => {
    const raw = {
      id: publicRoom,
      instanceId: publicRoom,
      worldId,
      type: 'public',
      active: true,
      full: false,
      hasCapacityForYou: true,
      roleRestricted: false,
      ageGate: false,
      closedAt: null,
      hardClose: null,
      n_users: Number.MAX_SAFE_INTEGER + 1
    }
    expect(parseVrcExploreRoom(raw, worldId, publicRoom)?.occupancy).toEqual({
      state: 'unknown',
      value: null,
      source: 'unknown'
    })
  })
})
