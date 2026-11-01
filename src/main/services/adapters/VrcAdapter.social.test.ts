import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { SocialDataError } from './SocialActionAdapter'
import { AuthError, RateLimitError } from './errors'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const ME = 'usr_12345678-1234-1234-1234-123456789abc'
const FRIEND = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const BASE = 'https://api.vrchat.cloud/api/1'

function store(): VrcCredentialStore {
  return { load: () => 'auth=synthetic', save: () => {}, delete: () => {} }
}

function signedIn(): VrcAdapter {
  const adapter = new VrcAdapter(store(), instantAdmission())
  markVrcSessionEstablished(adapter)
  Object.assign(adapter as unknown as { accountId: string }, { accountId: ME })
  return adapter
}

type Sent = { method: string; headers: Record<string, string>; body?: string }
function sent(fetchMock: ReturnType<typeof vi.fn>, index = 0): [string, Sent] {
  return fetchMock.mock.calls[index] as unknown as [string, Sent]
}

describe('VrcAdapter unfriend and block', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads block state for exactly one person', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse([{ id: 'pmod_1', type: 'block', targetUserId: FRIEND }]))
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).resolves.toBe(true)
    const [url, options] = sent(fetchMock)
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/api/1/auth/user/playermoderations')
    expect(parsed.searchParams.get('type')).toBe('block')
    expect(parsed.searchParams.get('targetUserId')).toBe(FRIEND)
    expect(options.method).toBe('GET')
  })

  it('treats an unreadable block reply as malformed, not as unblocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' })))
    const adapter = signedIn()
    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).rejects.toBeInstanceOf(
      SocialDataError
    )
  })

  it('sends each write once, with the documented route and body', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ success: {} })))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await adapter.unfriend(FRIEND, adapter.captureSocialLease())
    await adapter.block(FRIEND, adapter.captureSocialLease())
    await adapter.unblock(FRIEND, adapter.captureSocialLease())

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [unfriendUrl, unfriend] = sent(fetchMock, 0)
    expect(unfriendUrl).toBe(`${BASE}/auth/user/friends/${FRIEND}`)
    expect(unfriend.method).toBe('DELETE')
    expect(unfriend.body).toBeUndefined()
    const [blockUrl, block] = sent(fetchMock, 1)
    expect(blockUrl).toBe(`${BASE}/auth/user/playermoderations`)
    expect(block.method).toBe('POST')
    expect(JSON.parse(block.body!)).toEqual({ moderated: FRIEND, type: 'block' })
    const [unblockUrl, unblock] = sent(fetchMock, 2)
    expect(unblockUrl).toBe(`${BASE}/auth/user/unplayermoderate`)
    expect(unblock.method).toBe('PUT')
    expect(JSON.parse(unblock.body!)).toEqual({ moderated: FRIEND, type: 'block' })
    for (let index = 0; index < 3; index++) {
      expect(sent(fetchMock, index)[1].headers).toMatchObject({ Cookie: 'auth=synthetic' })
    }
  })

  it('never resends a write after a 429', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(adapter.block(FRIEND, adapter.captureSocialLease())).rejects.toBeInstanceOf(
      RateLimitError
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a malformed person ID before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    for (const bad of ['usr_x/../../auth', '../auth/user', '']) {
      await expect(adapter.unfriend(bad, adapter.captureSocialLease())).rejects.toBeInstanceOf(
        SocialDataError
      )
      await expect(adapter.block(bad, adapter.captureSocialLease())).rejects.toBeInstanceOf(
        SocialDataError
      )
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a data-path 401 invalidates the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const adapter = signedIn()
    const events: string[] = []
    adapter.subscribe((event) => events.push(event.type))
    await expect(adapter.unfriend(FRIEND, adapter.captureSocialLease())).rejects.toBeInstanceOf(
      AuthError
    )
    expect(events).toContain('auth-invalidated')
  })

  it('needs a durable session to capture a lease', () => {
    const adapter = new VrcAdapter(store(), instantAdmission())
    expect(() => adapter.captureSocialLease()).toThrow()
  })
})
