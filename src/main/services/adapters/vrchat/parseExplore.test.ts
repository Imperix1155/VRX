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

  it('drops a world whose name is only spaces', () => {
    expect(
      parseVrcExploreCandidates([
        { id: worldId, name: '   ', occupants: 3 },
        { id: 'wrld_22222222-2222-2222-2222-222222222222', name: ' Spaced ', occupants: 3 }
      ])
    ).toEqual([expect.objectContaining({ name: ' Spaced ' })])
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
      roomsComplete: false,
      about: { creator: null, description: null, tags: [], capacity: null }
    })
    expect(JSON.stringify(result)).not.toContain('members must not escape')
  })

  it('reads the creator, description, own tags and room size from the same world response', () => {
    const detail = parseVrcExploreWorld(
      {
        id: worldId,
        name: 'Synthetic world',
        authorName: ' Sample Maker ',
        description: 'A quiet place.',
        capacity: 32,
        recommendedCapacity: 16,
        tags: ['author_tag_chill', 'system_approved', 'author_tag_Music', 'admin_hidden', 4],
        instances: []
      },
      worldId
    )!
    expect(detail.about).toEqual({
      creator: 'Sample Maker',
      description: 'A quiet place.',
      // Only the creator's own tags; system and admin labels stay out.
      tags: ['chill', 'Music'],
      capacity: 32
    })
  })

  it('bounds long world details and drops odd shapes', () => {
    const detail = parseVrcExploreWorld(
      {
        id: worldId,
        name: 'Synthetic world',
        authorName: 'n'.repeat(500),
        description: 'd'.repeat(5_000),
        capacity: -3,
        tags: Array.from({ length: 40 }, (_, index) => `author_tag_${'t'.repeat(60)}${index}`),
        instances: []
      },
      worldId
    )!
    expect(detail.about.creator).toHaveLength(64)
    expect(detail.about.description).toHaveLength(2_048)
    expect(detail.about.capacity).toBeNull()
    // A cut value says so with "…", inside the bound.
    expect(detail.about.creator?.endsWith('…')).toBe(true)
    expect(detail.about.description?.endsWith('…')).toBe(true)
    // Forty long tags cut to 32 characters are all the same word: one stays.
    expect(detail.about.tags).toEqual([`${'t'.repeat(31)}…`])
    const many = parseVrcExploreWorld(
      {
        id: worldId,
        name: 'Synthetic world',
        tags: Array.from({ length: 40 }, (_, index) => `author_tag_tag${index}`),
        instances: []
      },
      worldId
    )!
    expect(many.about.tags).toHaveLength(12)
  })

  it('keeps a description readable: line breaks stay, direction marks and controls go', () => {
    const detail = parseVrcExploreWorld(
      {
        id: worldId,
        name: 'Synthetic world',
        authorName: ' Bui\u202elder\tOne ',
        description: 'First line.  \r\nSecond line.\n\n\n\n\u202eThird\u2066 line.\u0007\n',
        tags: [
          'author_tag_late_night',
          'author_tag_\u202ertl',
          'author_tag_line\nbreak',
          'author_tag_a__b'
        ],
        instances: []
      },
      worldId
    )!
    expect(detail.about.creator).toBe('Builder One')
    expect(detail.about.description).toBe('First line.\nSecond line.\n\nThird line.')
    // Underscores read as spaces, as ChilloutVR's tags do; a tag is one line.
    expect(detail.about.tags).toEqual(['late night', 'rtl', 'line break', 'a b'])
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

  it.each(['closedAt', 'hardClose'])('keeps missing %s evidence unknown', (field) => {
    const raw: Record<string, unknown> = {
      worldId,
      instanceId: publicRoom,
      type: 'public',
      active: true,
      full: false,
      hasCapacityForYou: true,
      roleRestricted: false,
      ageGate: false,
      closedAt: null,
      hardClose: null
    }
    expect(parseVrcExploreRoom(raw, worldId, publicRoom)?.joinEligibility).toBe('eligible')
    delete raw[field]
    expect(parseVrcExploreRoom(raw, worldId, publicRoom)?.joinEligibility).toBe('unknown')
    raw[field] = undefined
    expect(parseVrcExploreRoom(raw, worldId, publicRoom)?.joinEligibility).toBe('unknown')
    delete raw[field]
    const inherited = Object.assign(Object.create({ [field]: '2026-09-10T00:00:00Z' }), raw)
    expect(parseVrcExploreRoom(inherited, worldId, publicRoom)?.joinEligibility).toBe('unknown')
    raw[field] = '2026-09-10T00:00:00Z'
    expect(parseVrcExploreRoom(raw, worldId, publicRoom)?.joinEligibility).toBe('unavailable')
    delete raw[field]
    raw.active = false
    expect(parseVrcExploreRoom(raw, worldId, publicRoom)?.joinEligibility).toBe('unavailable')
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

  it('keeps a room name, description and known spoken language, and drops everything else', () => {
    const base = { worldId, instanceId: publicRoom }
    const titled = parseVrcExploreRoom(
      {
        ...base,
        displayName: '  Friday\n lobby \u0000',
        description: 'Bring a chair.',
        dominantLanguage: 'EN',
        categoryId: 'icat_not-a-label',
        vibeIds: ['ivib_not-a-label'],
        ownerId: null,
        creatorId: 'usr_11111111-1111-1111-1111-111111111111'
      },
      worldId,
      publicRoom
    )
    expect(titled).toMatchObject({
      instanceTitle: 'Friday lobby',
      instanceDescription: 'Bring a chair.',
      spokenLanguage: 'en'
    })
    const encoded = JSON.stringify(titled)
    expect(encoded).not.toContain('icat_')
    expect(encoded).not.toContain('ivib_')
    expect(encoded).not.toContain('usr_')

    expect(
      parseVrcExploreRoom(
        { ...base, displayName: '   ', description: 12, dominantLanguage: 'english' },
        worldId,
        publicRoom
      )
    ).toMatchObject({
      instanceTitle: null,
      instanceDescription: null,
      spokenLanguage: null
    })

    const long = 'あ'.repeat(90)
    expect(
      parseVrcExploreRoom({ ...base, displayName: long }, worldId, publicRoom)?.instanceTitle
    ).toBe(`${'あ'.repeat(79)}…`)

    const inherited = Object.assign(
      Object.create({ displayName: 'Hidden', description: 'Hidden', dominantLanguage: 'ja' }),
      base
    )
    expect(parseVrcExploreRoom(inherited, worldId, publicRoom)).toMatchObject({
      instanceTitle: null,
      instanceDescription: null,
      spokenLanguage: null
    })
  })
})
