import { describe, expect, it } from 'vitest'
import {
  parseVrcGroups,
  parseVrcPeople,
  parseVrcPerson,
  parseVrcPlayersOnline,
  parseVrcProfile,
  parseVrcProfileWorlds
} from './parseCommunity'

const USER = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const WORLD = 'wrld_5a3c1e2d-0000-4000-8000-000000000002'
const GROUP = 'grp_5a3c1e2d-0000-4000-8000-000000000003'

describe('VRChat community parsers', () => {
  it('reads a person with the friends-list picture order', () => {
    expect(
      parseVrcPerson({
        id: USER,
        displayName: ' Lop ',
        userIcon: '',
        profilePicOverrideThumbnail: 'https://api.vrchat.cloud/thumb.png',
        currentAvatarThumbnailImageUrl: 'https://api.vrchat.cloud/avatar.png',
        isFriend: true
      })
    ).toEqual({
      platform: 'vrchat',
      userId: USER,
      displayName: 'Lop',
      imageUrl: 'https://api.vrchat.cloud/thumb.png',
      isFriend: true
    })
  })

  it('skips people without a valid ID or a name and ignores non-https pictures', () => {
    expect(parseVrcPerson({ id: 'usr_bad', displayName: 'x' })).toBeNull()
    expect(parseVrcPerson({ id: USER, displayName: '   ' })).toBeNull()
    expect(parseVrcPerson({ id: '../auth', displayName: 'x' })).toBeNull()
    expect(
      parseVrcPerson({ id: USER, displayName: 'x', userIcon: 'http://insecure/p.png' })?.imageUrl
    ).toBeNull()
  })

  it('reads the profile fields, trust rank and visible badges (showcased first)', () => {
    const profile = parseVrcProfile({
      id: USER,
      displayName: 'Lop',
      pronouns: 'they/them',
      bio: 'Hello\nworld',
      tags: ['system_trust_basic', 'system_trust_known'],
      badges: [
        { badgeName: 'Early', badgeImageUrl: 'https://assets.vrchat.com/a.png' },
        { badgeName: 'Hidden', hidden: true },
        { badgeName: 'Supporter', showcased: true },
        { badgeImageUrl: 'https://x/no-name.png' }
      ]
    })
    expect(profile).toMatchObject({
      pronouns: 'they/them',
      bio: 'Hello\nworld',
      rank: { kind: 'vrchat-trust', value: 'user' },
      badges: [
        { name: 'Supporter', imageUrl: null },
        { name: 'Early', imageUrl: 'https://assets.vrchat.com/a.png' }
      ]
    })
    expect(parseVrcProfile({ id: USER, displayName: 'Lop' })).toMatchObject({
      pronouns: null,
      bio: null,
      rank: null,
      badges: []
    })
  })

  it('caps and de-duplicates people, marking a cut list incomplete', () => {
    const people = [1, 2, 3].map((n) => ({
      id: `usr_5a3c1e2d-0000-4000-8000-00000000000${n}`,
      displayName: `P${n}`
    }))
    expect(parseVrcPeople([...people, people[0]], 10)).toMatchObject({
      complete: true,
      items: [{ displayName: 'P1' }, { displayName: 'P2' }, { displayName: 'P3' }]
    })
    expect(parseVrcPeople(people, 2)?.complete).toBe(false)
    expect(parseVrcPeople([{ id: 'bad' }], 2)).toEqual({ items: [], complete: false })
    expect(parseVrcPeople({ not: 'array' }, 2)).toBeNull()
  })

  it('reads public worlds for display only', () => {
    expect(
      parseVrcProfileWorlds([
        { id: WORLD, name: 'Cafe', thumbnailImageUrl: 'https://files.vrchat.cloud/t.png' },
        { id: 'wrld_bad', name: 'x' }
      ])
    ).toEqual({
      items: [
        {
          platform: 'vrchat',
          worldId: WORLD,
          name: 'Cafe',
          imageUrl: 'https://files.vrchat.cloud/t.png'
        }
      ],
      complete: false
    })
    expect(parseVrcProfileWorlds(null)).toBeNull()
  })

  it('reads group memberships with the group ID, code and own role', () => {
    const groups = parseVrcGroups(
      [
        {
          id: 'gmem_5a3c1e2d-0000-4000-8000-000000000009',
          groupId: GROUP,
          name: 'Cafe Club',
          shortCode: 'CAFE',
          discriminator: '0420',
          description: 'Coffee',
          iconUrl: 'https://api.vrchat.cloud/icon.png',
          bannerUrl: 'https://api.vrchat.cloud/banner.png',
          memberCount: 42,
          ownerId: USER
        },
        { id: GROUP, name: 'Plain', ownerId: 'someone-else', memberCount: -1 },
        { id: 'gmem_only', name: 'No group id' }
      ],
      USER,
      10
    )
    expect(groups).toEqual({
      items: [
        {
          platform: 'vrchat',
          groupId: GROUP,
          name: 'Cafe Club',
          code: 'CAFE.0420',
          description: 'Coffee',
          imageUrl: 'https://api.vrchat.cloud/icon.png',
          bannerUrl: 'https://api.vrchat.cloud/banner.png',
          memberCount: 42,
          role: 'owner'
        }
      ],
      complete: false
    })
    expect(
      parseVrcGroups([{ groupId: GROUP, name: 'G', ownerId: USER }], null, 5)?.items[0]?.role
    ).toBeNull()
  })

  it('asks for the bounded rendition of uploaded group icons and banners', () => {
    const file = 'file_0a1b2c3d-0000-4000-8000-00000000000a'
    const group = parseVrcGroups(
      [
        {
          groupId: GROUP,
          name: 'Big Icon Club',
          iconUrl: `https://api.vrchat.cloud/api/1/file/${file}/3/file`,
          bannerUrl: `https://api.vrchat.cloud/api/1/file/${file}/7`
        }
      ],
      USER,
      5
    )?.items[0]
    expect(group?.imageUrl).toBe(`https://api.vrchat.cloud/api/1/image/${file}/3/256`)
    expect(group?.bannerUrl).toBe(`https://api.vrchat.cloud/api/1/image/${file}/7/1024`)
  })

  it('reads the player count only as a whole non-negative number', () => {
    expect(parseVrcPlayersOnline(54321)).toBe(54321)
    expect(parseVrcPlayersOnline('54321')).toBeNull()
    expect(parseVrcPlayersOnline(-1)).toBeNull()
    expect(parseVrcPlayersOnline(1.5)).toBeNull()
  })
})
