import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { AvatarDataError } from './AvatarLibraryAdapter'
import { CVRRateLimitError } from './errors'
import { instantAdmission, jsonResponse } from './__testutils__/adapterTestKit'

const ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'
const A = 'b81d5892-5119-4f44-b473-7bf4ffda0458'

function store(): CvrCredentialStore {
  const credentials: CVRCredentials = { username: 'cvr-user', accessKey: 'cvr-access-key' }
  return { load: () => credentials, save: () => {}, delete: () => {} }
}

function signedIn(): CvrAdapter {
  const adapter = new CvrAdapter(store(), instantAdmission())
  Object.assign(
    adapter as unknown as { validated: boolean; accountId: string; displayName: string },
    { validated: true, accountId: ME, displayName: 'Guide visitor' }
  )
  return adapter
}

function envelope(data: unknown): { message: string; data: unknown } {
  return { message: 'ok', data }
}

describe('CvrAdapter avatar library', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("reads one /avatars list and keeps the user's own uploads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        envelope([
          { id: A, name: 'Mine', authorGuid: ME, categories: ['avtrmine'] },
          {
            id: 'c81d5892-5119-4f44-b473-7bf4ffda0458',
            name: 'Shared',
            authorGuid: 'ffffffff-3eeb-426e-92ec-1b2f08e609b5',
            categories: ['avtrshared']
          }
        ])
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await expect(adapter.getOwnAvatars(adapter.captureAvatarLease())).resolves.toEqual({
      avatars: [expect.objectContaining({ avatarId: A, authorName: 'Guide visitor' })],
      complete: true
    })
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.abinteractive.net/1/avatars')
    expect(options.headers).toMatchObject({ Username: 'cvr-user', AccessKey: 'cvr-access-key' })
  })

  it('reads the worn avatar from the signed-in user record', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(envelope({ id: ME, avatar: { id: A, name: 'Worn' } })))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(adapter.getCurrentAvatar(adapter.captureAvatarLease())).resolves.toMatchObject({
      avatarId: A,
      name: 'Worn'
    })
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.abinteractive.net/1/users/${ME}`)
  })

  it('switches with one GET to switchAvatar and never retries it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Avatar changed', data: null }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await adapter.switchAvatar(A, adapter.captureAvatarLease())
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://api.abinteractive.net/1/avatars/${A}/switchAvatar`
    )
    await expect(adapter.switchAvatar(A, adapter.captureAvatarLease())).rejects.toBeInstanceOf(
      CVRRateLimitError
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads details for one avatar and checks the reply matches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(envelope({ id: A, name: 'Mine', isPublished: true, author: { name: 'Me' } }))
      )
      .mockResolvedValueOnce(
        jsonResponse(envelope({ id: 'c81d5892-5119-4f44-b473-7bf4ffda0458', name: 'Other' }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(adapter.getAvatarDetails(A, adapter.captureAvatarLease())).resolves.toMatchObject({
      visibility: 'public',
      authorName: 'Me'
    })
    await expect(adapter.getAvatarDetails(A, adapter.captureAvatarLease())).resolves.toBeNull()
  })

  it('refuses a malformed avatar ID before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(
      adapter.switchAvatar('../users/auth', adapter.captureAvatarLease())
    ).rejects.toBeInstanceOf(AvatarDataError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
