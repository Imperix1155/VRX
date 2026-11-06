import { describe, expect, it } from 'vitest'
import { parseCvrAvatarDetails, parseCvrCurrentAvatar, parseCvrOwnAvatars } from './parseAvatars'

const ME = '3A1661F1-3EEB-426E-92EC-1B2F08E609B5'
const OTHER = '9b1661f1-3eeb-426e-92ec-1b2f08e609b5'
const A = 'b81d5892-5119-4f44-b473-7bf4ffda0458'
const B = 'c81d5892-5119-4f44-b473-7bf4ffda0458'
const C = 'd81d5892-5119-4f44-b473-7bf4ffda0458'

describe('parseCvrOwnAvatars', () => {
  it("keeps only the signed-in user's uploads, not shared or favorite avatars", () => {
    const parsed = parseCvrOwnAvatars(
      [
        { id: A, name: 'Mine', authorGuid: ME.toLowerCase(), categories: ['avtrmine'] },
        { id: B, name: 'Shared', authorGuid: OTHER, categories: ['avtrshared'] },
        {
          id: C.toUpperCase(),
          name: 'Tagged',
          categories: ['avtrmine'],
          imageUrl: 'https://files.abidata.io/a.png'
        },
        { id: 'not-a-guid', name: 'Broken', authorGuid: ME }
      ],
      ME,
      'Guide visitor'
    )
    expect(parsed?.skipped).toBe(1)
    expect(parsed?.avatars.map((avatar) => avatar.avatarId)).toEqual([A, C])
    expect(parsed?.avatars[1]).toMatchObject({
      platform: 'chilloutvr',
      name: 'Tagged',
      authorName: 'Guide visitor',
      imageUrl: 'https://files.abidata.io/a.png',
      visibility: null,
      createdAt: null
    })
  })

  it('treats a non-array reply as malformed', () => {
    expect(parseCvrOwnAvatars({ data: [] }, ME, null)).toBeNull()
  })
})

describe('parseCvrAvatarDetails', () => {
  it('reads author, published state and dates', () => {
    expect(
      parseCvrAvatarDetails({
        id: A,
        name: 'Mine',
        description: 'Hello',
        imageUrl: 'https://files.abidata.io/a.png',
        author: { id: ME, name: 'Guide visitor' },
        isPublished: false,
        uploadedAt: '2026-01-02T03:04:05Z',
        updatedAt: '2026-02-02T03:04:05Z'
      })
    ).toEqual({
      platform: 'chilloutvr',
      avatarId: A,
      name: 'Mine',
      description: 'Hello',
      imageUrl: 'https://files.abidata.io/a.png',
      authorName: 'Guide visitor',
      visibility: 'private',
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-02T03:04:05.000Z'
    })
  })
})

describe('parseCvrCurrentAvatar', () => {
  it('reads the worn avatar from the user record without assuming an author', () => {
    expect(
      parseCvrCurrentAvatar({ id: ME, avatar: { id: A, name: 'Worn', imageUrl: null } })
    ).toMatchObject({ avatarId: A, name: 'Worn', authorName: null })
    expect(parseCvrCurrentAvatar({ id: ME })).toBeNull()
  })
})
