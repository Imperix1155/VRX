import { describe, expect, it } from 'vitest'
import { parseVrcAvatar, parseVrcAvatarPage } from './parseAvatars'

const ID = 'avtr_5a3c1e2d-0000-4000-8000-000000000001'

describe('parseVrcAvatar', () => {
  it('keeps the fields the Avatars page shows', () => {
    expect(
      parseVrcAvatar({
        id: ID,
        name: '  Lumen Fox ',
        description: '',
        authorName: 'Someone',
        imageUrl: 'https://api.vrchat.cloud/api/1/file/file_a/1/file',
        thumbnailImageUrl: 'https://api.vrchat.cloud/api/1/image/file_a/1/256',
        releaseStatus: 'public',
        created_at: '2026-03-14T12:00:00Z',
        updated_at: 'not a date',
        unityPackages: [{ platform: 'standalonewindows' }]
      })
    ).toEqual({
      platform: 'vrchat',
      avatarId: ID,
      name: 'Lumen Fox',
      description: null,
      imageUrl: 'https://api.vrchat.cloud/api/1/image/file_a/1/256',
      authorName: 'Someone',
      visibility: 'public',
      createdAt: '2026-03-14T12:00:00.000Z',
      updatedAt: null
    })
  })

  it('skips records without a valid ID or name and drops unsafe image URLs', () => {
    expect(parseVrcAvatar({ id: 'wrld_x', name: 'World' })).toBeNull()
    expect(parseVrcAvatar({ id: ID, name: '' })).toBeNull()
    expect(parseVrcAvatar(null)).toBeNull()
    const avatar = parseVrcAvatar({
      id: ID,
      name: 'A',
      thumbnailImageUrl: 'http://api.vrchat.cloud/x',
      imageUrl: 'javascript:alert(1)',
      releaseStatus: 'hidden'
    })
    expect(avatar?.imageUrl).toBeNull()
    expect(avatar?.visibility).toBeNull()
  })

  it('treats a non-array page as malformed and counts skipped records', () => {
    expect(parseVrcAvatarPage({ avatars: [] })).toBeNull()
    expect(parseVrcAvatarPage([{ id: ID, name: 'A' }, { id: 'bad' }])).toMatchObject({
      received: 2,
      skipped: 1,
      avatars: [{ avatarId: ID }]
    })
  })
})
