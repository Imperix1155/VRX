import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import { CvrAdapter, type CvrCredentialStore } from './CvrAdapter'
import { VrcAdapter, type VrcCredentialStore } from './VrcAdapter'
import { FriendActionRefusedError, FriendActionUnavailableError } from './FriendActionsAdapter'
import { AuthError, CVRRateLimitError, NetworkError, RateLimitError } from './errors'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const VRC_ME = 'usr_12345678-1234-1234-1234-123456789abc'
const VRC_THEM = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const NOTIFICATION = 'not_5a3c1e2d-0000-4000-8000-000000000001'
const CVR_ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'
const CVR_THEM = 'B81D5892-5119-4F44-B473-7BF4FFDA0458'

function vrcSignedIn(): VrcAdapter {
  const store: VrcCredentialStore = {
    load: () => 'auth=synthetic',
    save: () => {},
    delete: () => {}
  }
  const adapter = new VrcAdapter(store, instantAdmission())
  markVrcSessionEstablished(adapter)
  Object.assign(adapter as unknown as { accountId: string }, { accountId: VRC_ME })
  return adapter
}

function request(
  fetchMock: ReturnType<typeof vi.fn>,
  index = 0
): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index] as [string, RequestInit]
  return { url: call[0], init: call[1] }
}

describe('VrcAdapter friend actions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('accepts with PUT …/accept and declines with PUT …/hide, no body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: { status_code: 200 } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()
    const record = { sourceId: NOTIFICATION, senderId: VRC_THEM }

    await adapter.answerFriendRequest(record, 'accept', adapter.captureFriendActionLease())
    await adapter.answerFriendRequest(record, 'decline', adapter.captureFriendActionLease())

    expect(request(fetchMock, 0).url).toBe(
      `https://api.vrchat.cloud/api/1/auth/user/notifications/${NOTIFICATION}/accept`
    )
    expect(request(fetchMock, 0).init.method).toBe('PUT')
    expect(request(fetchMock, 0).init.body).toBeUndefined()
    expect(request(fetchMock, 1).url).toBe(
      `https://api.vrchat.cloud/api/1/auth/user/notifications/${NOTIFICATION}/hide`
    )
    const headers = request(fetchMock, 0).init.headers as Record<string, string>
    expect(headers['User-Agent']).toMatch(/^VRX\//)
    expect(headers['Cookie']).toBe('auth=synthetic')
  })

  it('sends a friend request with one POST and no body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'frq_1' }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    await adapter.sendFriendRequest(VRC_THEM, adapter.captureFriendActionLease())

    expect(request(fetchMock).url).toBe(
      `https://api.vrchat.cloud/api/1/user/${VRC_THEM}/friendRequest`
    )
    expect(request(fetchMock).init.method).toBe('POST')
    expect(request(fetchMock).init.body).toBeUndefined()
  })

  it('never retries a write after a 429', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 429, headers: { 'Retry-After': '0' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()
    await expect(
      adapter.sendFriendRequest(VRC_THEM, adapter.captureFriendActionLease())
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads a 4xx as a refusal, 5xx as a failure, and 401 as signed out', async () => {
    const adapter = vrcSignedIn()
    const record = { sourceId: NOTIFICATION, senderId: VRC_THEM }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 }))
    )
    await expect(
      adapter.answerFriendRequest(record, 'accept', adapter.captureFriendActionLease())
    ).rejects.toBeInstanceOf(FriendActionRefusedError)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 }))
    )
    await expect(
      adapter.answerFriendRequest(record, 'accept', adapter.captureFriendActionLease())
    ).rejects.toBeInstanceOf(NetworkError)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 }))
    )
    await expect(
      adapter.answerFriendRequest(record, 'accept', adapter.captureFriendActionLease())
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('refuses a malformed ID or the signed-in user before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()
    const lease = adapter.captureFriendActionLease()
    await expect(adapter.sendFriendRequest('../auth/user', lease)).rejects.toBeInstanceOf(
      FriendActionRefusedError
    )
    await expect(adapter.sendFriendRequest(VRC_ME, lease)).rejects.toBeInstanceOf(
      FriendActionRefusedError
    )
    await expect(
      adapter.answerFriendRequest({ sourceId: '../x', senderId: VRC_THEM }, 'accept', lease)
    ).rejects.toBeInstanceOf(FriendActionRefusedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

interface FakePipeline {
  isConnected: () => boolean
  acceptFriendRequest: ReturnType<typeof vi.fn>
  declineFriendRequest: ReturnType<typeof vi.fn>
  sendFriendRequest: ReturnType<typeof vi.fn>
}

function cvrSignedIn(open = true): { adapter: CvrAdapter; pipeline: FakePipeline } {
  const credentials: CVRCredentials = { username: 'cvr-user', accessKey: 'cvr-access-key' }
  const store: CvrCredentialStore = { load: () => credentials, save: () => {}, delete: () => {} }
  const adapter = new CvrAdapter(store, instantAdmission())
  const pipeline: FakePipeline = {
    isConnected: () => open,
    acceptFriendRequest: vi.fn(() => open),
    declineFriendRequest: vi.fn(() => open),
    sendFriendRequest: vi.fn(() => open)
  }
  Object.assign(
    adapter as unknown as { validated: boolean; accountId: string; pipeline: unknown },
    { validated: true, accountId: CVR_ME, pipeline }
  )
  return { adapter, pipeline }
}

describe('CvrAdapter friend actions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('answers and sends over the live socket with the lowercased sender ID, no REST', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, pipeline } = cvrSignedIn()
    const record = { sourceId: CVR_THEM.toLowerCase(), senderId: CVR_THEM }

    await adapter.answerFriendRequest(record, 'accept', adapter.captureFriendActionLease())
    await adapter.answerFriendRequest(record, 'decline', adapter.captureFriendActionLease())
    await adapter.sendFriendRequest(CVR_THEM, adapter.captureFriendActionLease())

    expect(pipeline.acceptFriendRequest).toHaveBeenCalledWith(CVR_THEM.toLowerCase())
    expect(pipeline.declineFriendRequest).toHaveBeenCalledWith(CVR_THEM.toLowerCase())
    expect(pipeline.sendFriendRequest).toHaveBeenCalledWith(CVR_THEM.toLowerCase())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a closed socket as unavailable instead of queueing the action', async () => {
    const { adapter } = cvrSignedIn(false)
    expect(adapter.canSendFriendAction()).toBe(false)
    expect(cvrSignedIn(true).adapter.canSendFriendAction()).toBe(true)
    await expect(
      adapter.sendFriendRequest(CVR_THEM, adapter.captureFriendActionLease())
    ).rejects.toBeInstanceOf(FriendActionUnavailableError)
  })

  it('honors a 429 cooldown before sending a frame', async () => {
    const { adapter, pipeline } = cvrSignedIn()
    const lease = adapter.captureFriendActionLease()
    Object.defineProperty(
      (adapter as unknown as { admission: object }).admission,
      'cooldownRemainingMs',
      { get: () => 5_000 }
    )
    await expect(adapter.sendFriendRequest(CVR_THEM, lease)).rejects.toBeInstanceOf(
      CVRRateLimitError
    )
    expect(pipeline.sendFriendRequest).not.toHaveBeenCalled()
  })

  it('refuses a malformed ID or the signed-in user before sending', async () => {
    const { adapter, pipeline } = cvrSignedIn()
    const lease = adapter.captureFriendActionLease()
    await expect(adapter.sendFriendRequest('not-a-guid', lease)).rejects.toBeInstanceOf(
      FriendActionRefusedError
    )
    await expect(adapter.sendFriendRequest(CVR_ME.toUpperCase(), lease)).rejects.toBeInstanceOf(
      FriendActionRefusedError
    )
    expect(pipeline.sendFriendRequest).not.toHaveBeenCalled()
  })
})
