import { describe, expect, it } from 'vitest'
import {
  parseCvrGroups,
  parseCvrPerson,
  parseCvrPlayersOnline,
  parseCvrProfile,
  parseCvrProfileWorlds,
  parseCvrSearch
} from './parseCommunity'

const USER = 'C4EEE443-98A0-BAB8-A583-F1D9FA10A7D7'
const WORLD = '978f6939-f914-40c2-833b-eb94e7099a97'
const GROUP = '64c90a65-78a2-4b24-a5dc-36f815311d7b'

describe('ChilloutVR community parsers', () => {
  it('reads a person and lowercases the ID to match the friends list', () => {
    expect(
      parseCvrPerson({
        id: USER,
        name: 'Lop',
        imageUrl: 'https://files.chilloutvr.net/u.png',
        isFriend: false
      })
    ).toEqual({
      platform: 'chilloutvr',
      userId: USER.toLowerCase(),
      displayName: 'Lop',
      imageUrl: 'https://files.chilloutvr.net/u.png',
      isFriend: false
    })
    expect(parseCvrPerson({ id: 'not-a-guid', name: 'x' })).toBeNull()
  })

  it('reads bio, pronouns, rank and a featured badge, skipping the placeholder', () => {
    expect(
      parseCvrProfile({
        id: USER,
        name: 'Lop',
        profileBio: 'Hi',
        profilePronouns: 'she/her',
        rank: 'Moderator',
        featuredBadge: { name: 'Alpha', image: 'https://files.abidata.io/b.png' }
      })
    ).toMatchObject({
      bio: 'Hi',
      pronouns: 'she/her',
      rank: { kind: 'label', value: 'Moderator' },
      badges: [{ name: 'Alpha', imageUrl: 'https://files.abidata.io/b.png' }]
    })
    expect(
      parseCvrProfile({ id: USER, name: 'Lop', featuredBadge: { name: 'No badge featured' } })
    ).toMatchObject({ bio: null, pronouns: null, rank: null, badges: [] })
  })

  it('keeps only people and worlds from a mixed search, capped per kind', () => {
    const result = parseCvrSearch(
      [
        { type: 'user', id: USER, name: 'Lop', imageUrl: 'https://files.chilloutvr.net/u.png' },
        { type: 'avatar', id: WORLD, name: 'An avatar' },
        { type: 'world', id: WORLD, name: 'Cafe', imageUrl: 'https://files.chilloutvr.net/w.png' },
        { type: 'prop', id: WORLD, name: 'A prop' },
        { type: 'user', id: USER, name: 'Duplicate' },
        { type: 'world', id: 'bad', name: 'Bad' }
      ],
      10
    )
    expect(result?.people.map((p) => p.displayName)).toEqual(['Lop'])
    expect(result?.worlds).toMatchObject([{ platform: 'chilloutvr', worldId: WORLD, name: 'Cafe' }])
    expect(parseCvrSearch({ data: [] }, 10)).toBeNull()
  })

  it('reads public worlds for display only', () => {
    expect(
      parseCvrProfileWorlds([
        { id: WORLD.toUpperCase(), name: 'Cafe' },
        { id: WORLD, name: '' }
      ])
    ).toEqual({
      items: [{ platform: 'chilloutvr', worldId: WORLD, name: 'Cafe', imageUrl: null }],
      complete: false
    })
  })

  it('reads owned and member groups with the own role, or no role for someone else', () => {
    const value = {
      owned: [
        {
          id: GROUP,
          tag: 'CVRX',
          name: 'CVRX',
          description: 'Contributors',
          memberCount: 3,
          image: 'https://files.abidata.io/g.png',
          banner: 'https://files.abidata.io/b.png'
        }
      ],
      member: [{ id: '560912fc-5ffd-41c2-abf2-ddbc26e79831', name: 'Lop', memberCount: 1 }]
    }
    expect(parseCvrGroups(value, true, 10)?.items.map((g) => [g.name, g.role, g.code])).toEqual([
      ['CVRX', 'owner', 'CVRX'],
      ['Lop', 'member', null]
    ])
    expect(parseCvrGroups(value, false, 10)?.items.map((g) => g.role)).toEqual([null, null])
    expect(parseCvrGroups(value, true, 1)).toMatchObject({ complete: false })
    expect(parseCvrGroups([], true, 1)).toBeNull()
  })

  it('reads the overall online count', () => {
    expect(
      parseCvrPlayersOnline({
        usersOnline: { overall: 47, public: 14, notConnected: 9, other: 24 }
      })
    ).toBe(47)
    expect(parseCvrPlayersOnline({ usersOnline: { overall: '47' } })).toBeNull()
    expect(parseCvrPlayersOnline(null)).toBeNull()
  })
})
