import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { AvatarDataError } from './AvatarLibraryAdapter'
import { AuthError, RateLimitError } from './errors'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const USER = 'usr_12345678-1234-1234-1234-123456789abc'

function store(): VrcCredentialStore {
  return { load: () => 'auth=synthetic', save: () => {}, delete: () => {} }
}

function avatarId(index: number): string {
  return `avtr_5a3c1e2d-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function avatar(index: number): Record<string, unknown> {
  return { id: avatarId(index), name: `Avatar ${index}`, releaseStatus: 'private' }
}

function signedIn(): VrcAdapter {
  const adapter = new VrcAdapter(store(), instantAdmission())
  markVrcSessionEstablished(adapter)
  Object.assign(adapter as unknown as { accountId: string }, { accountId: USER })
  return adapter
}

describe('VrcAdapter avatar library', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('pages own avatars 100 at a time and stops at a short page', async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => avatar(i)), [avatar(100), avatar(0)]]
    const fetchMock = vi.fn(async () => jsonResponse(pages.shift() ?? []))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    const result = await adapter.getOwnAvatars(adapter.captureAvatarLease())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])))
    expect(urls.map((url) => url.pathname)).toEqual(['/api/1/avatars', '/api/1/avatars'])
    expect(urls[0]!.searchParams.get('user')).toBe('me')
    expect(urls[0]!.searchParams.get('releaseStatus')).toBe('all')
    expect(urls[0]!.searchParams.get('n')).toBe('100')
    expect(urls[1]!.searchParams.get('offset')).toBe('100')
    // The duplicate on page two is dropped; nothing was unreadable.
    expect(result.avatars).toHaveLength(101)
    expect(result.complete).toBe(true)
  })

  it('stops at the item cap and reports the list as incomplete', async () => {
    let page = 0
    const fetchMock = vi.fn(async () =>
      jsonResponse(Array.from({ length: 100 }, (_, i) => avatar(page++ * 100 + i)))
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    const result = await adapter.getOwnAvatars(adapter.captureAvatarLease())

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(result.complete).toBe(false)
  })

  it('treats a non-array list reply as malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' })))
    const adapter = signedIn()
    await expect(adapter.getOwnAvatars(adapter.captureAvatarLease())).rejects.toBeInstanceOf(
      AvatarDataError
    )
  })

  it('reads the worn avatar from the signed-in user only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(avatar(7)))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await expect(adapter.getCurrentAvatar(adapter.captureAvatarLease())).resolves.toMatchObject({
      avatarId: avatarId(7)
    })
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://api.vrchat.cloud/api/1/users/${encodeURIComponent(USER)}/avatar`
    )
  })

  it('switches with one PUT to the select route and never retries it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: USER }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await adapter.switchAvatar(avatarId(3), adapter.captureAvatarLease())
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.vrchat.cloud/api/1/avatars/${avatarId(3)}/select`)
    expect(options).toMatchObject({ method: 'PUT', redirect: 'error' })
    expect(options.headers).toMatchObject({ Cookie: 'auth=synthetic' })

    await expect(
      adapter.switchAvatar(avatarId(4), adapter.captureAvatarLease())
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a malformed avatar ID before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(
      adapter.switchAvatar('avtr_x/../../auth', adapter.captureAvatarLease())
    ).rejects.toBeInstanceOf(AvatarDataError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a data-path 401 invalidates the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const adapter = signedIn()
    const events: string[] = []
    adapter.subscribe((event) => events.push(event.type))
    await expect(adapter.getOwnAvatars(adapter.captureAvatarLease())).rejects.toBeInstanceOf(
      AuthError
    )
    expect(events).toContain('auth-invalidated')
  })

  it('needs a durable session to capture a lease', () => {
    const adapter = new VrcAdapter(store(), instantAdmission())
    expect(() => adapter.captureAvatarLease()).toThrow()
  })
})
