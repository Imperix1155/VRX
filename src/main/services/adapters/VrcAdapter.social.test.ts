import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { SocialDataError } from './SocialActionAdapter'
import { AuthError, RateLimitError } from './errors'
import { RELATIONSHIP_CACHE_MS } from '@shared/socialActions'
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

  it('reads the block list the way VRCX does, once for every profile', async () => {
    const OTHER = 'usr_5a3c1e2d-0000-4000-8000-000000000002'
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse([
          { id: 'pmod_1', type: 'block', targetUserId: FRIEND },
          { id: 'pmod_2', type: 'mute', targetUserId: OTHER }
        ])
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).resolves.toBe(true)
    await expect(adapter.getBlocked(OTHER, adapter.captureSocialLease())).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = sent(fetchMock)
    // No filter: VRCX asks for the whole list, and the filtered form read as
    // "signed out" on a real account.
    expect(url).toBe(`${BASE}/auth/user/playermoderations`)
    expect(options.method).toBe('GET')
  })

  it('shares one read between two profiles asking at once', async () => {
    let answer: (value: Response) => void = () => {}
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    const first = adapter.getBlocked(FRIEND, adapter.captureSocialLease())
    const second = adapter.getBlocked(ME, adapter.captureSocialLease())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    answer(jsonResponse([{ type: 'block', targetUserId: FRIEND }]))
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the remembered list in step with its own block and unblock', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/auth/user/playermoderations') && fetchMock.mock.calls.length === 1
          ? jsonResponse([])
          : jsonResponse({ success: {} })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).resolves.toBe(false)
    await adapter.block(FRIEND, adapter.captureSocialLease())
    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).resolves.toBe(true)
    await adapter.unblock(FRIEND, adapter.captureSocialLease())
    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).resolves.toBe(false)
    // One list read, then only the two writes.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reads the list again after five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])))
      vi.stubGlobal('fetch', fetchMock)
      const adapter = signedIn()
      await adapter.getBlocked(FRIEND, adapter.captureSocialLease())
      vi.setSystemTime(Date.now() + RELATIONSHIP_CACHE_MS - 1)
      await adapter.getBlocked(FRIEND, adapter.captureSocialLease())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 2)
      await adapter.getBlocked(FRIEND, adapter.captureSocialLease())
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
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

  it('never resends a self-invite after a 429', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    await expect(adapter.selfInvite('wrld_example:12345~private(usr_self)')).rejects.toThrow()
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

  it('never names the signed-in user in a write', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()
    for (const action of ['unfriend', 'block', 'unblock'] as const) {
      await expect(adapter[action](ME, adapter.captureSocialLease())).rejects.toBeInstanceOf(
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
