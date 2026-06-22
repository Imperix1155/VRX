import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CVR_API_BASE, CVR_PLATFORM } from '@shared/constants'
import type { AuthStatus, Friend, InstanceInfo, LoginResult } from '@shared/types'
import type { Unsubscribe } from './IPlatformAdapter'
import { CVRAuthError, CVRNetworkError } from './errors'
import { CvrApiClient, type CVRUserAuth } from './CvrApiClient'

const noopSleep = (): Promise<void> => Promise.resolve()
const userSchema = z.object({ id: z.string(), username: z.string() })

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const authData: CVRUserAuth = {
  username: 'CVR User',
  accessKey: 'access-key',
  userId: 'user-id',
  currentAvatar: 'avatar-id',
  currentHomeWorld: 'world-id',
  videoUrlResolverExecutable: 'https://example.com/resolver',
  videoUrlResolverHashes: 'https://example.com/hashes',
  blockedUsers: ['blocked-user-id']
}

class TestClient extends CvrApiClient {
  constructor(sleepFn: (ms: number) => Promise<void> = noopSleep) {
    super(sleepFn)
  }
  callGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.get(path, schema)
  }
  callPost<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.post(path, body, schema)
  }
  setAuth(username: string, accessKey: string): void {
    this.setCredentials({ username, accessKey })
  }
  clearAuth(): void {
    this.setCredentials(null)
  }
  callLogin(email: string, password: string): Promise<CVRUserAuth> {
    return this.loginWithPassword(email, password)
  }
  callReauthenticate(username: string, accessKey: string): Promise<CVRUserAuth> {
    return this.reauthenticate(username, accessKey)
  }
  getAuthStatus(): Promise<AuthStatus> {
    throw new Error('stub')
  }
  login(): Promise<LoginResult> {
    throw new Error('stub')
  }
  verify2fa(): Promise<LoginResult> {
    throw new Error('stub')
  }
  importSession(): Promise<boolean> {
    throw new Error('stub')
  }
  getFriends(): Promise<Friend[]> {
    throw new Error('stub')
  }
  getInstanceDetails(): Promise<InstanceInfo> {
    throw new Error('stub')
  }
  joinInstance(): Promise<void> {
    throw new Error('stub')
  }
  selfInvite(): Promise<void> {
    throw new Error('stub')
  }
  subscribe(): Unsubscribe {
    return () => {}
  }
}

describe('CvrApiClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('unwraps a validated envelope and sends CVR auth headers on GET', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'ok', data: { id: 'user-id', username: 'CVR User' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const client = new TestClient()
    client.setAuth('CVR User', 'access-key')

    await expect(client.callGet('/users/me', userSchema)).resolves.toEqual({
      id: 'user-id',
      username: 'CVR User'
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${CVR_API_BASE}/users/me`)
    expect(options.method).toBe('GET')
    expect(options.headers).toMatchObject({
      Username: 'CVR User',
      AccessKey: 'access-key',
      Platform: CVR_PLATFORM,
      CompatibleVersions: '0,1,2',
      MatureContentDlc: 'false'
    })
    expect(options.headers['User-Agent']).toMatch(/^VRX\//)
    expect(options.headers['User-Agent']).toContain('github.com/Imperix1155/VRX')
    expect(options.headers.Authorization).toBeUndefined()
    expect(options.redirect).toBe('error')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('POSTs JSON and unwraps the validated response data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'ok', data: { id: 'user-id', username: 'New' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new TestClient()
    client.setAuth('CVR User', 'access-key')

    await client.callPost('/users/update', { username: 'New' }, userSchema)

    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.body).toBe(JSON.stringify({ username: 'New' }))
  })

  it('rejects responses whose envelope or data does not match the schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'ok', data: { id: 123, username: 'A' } }))
    )
    const client = new TestClient()
    client.setAuth('CVR User', 'access-key')

    await expect(client.callGet('/users/me', userSchema)).rejects.toBeInstanceOf(CVRNetworkError)
  })

  it('throws CVRAuthError for an authenticated request without credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(new TestClient().callGet('/users/me', userSchema)).rejects.toBeInstanceOf(
      CVRAuthError
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops sending authenticated requests after credentials are cleared', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'ok', data: { id: 'user-id', username: 'CVR User' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const client = new TestClient()
    client.setAuth('CVR User', 'access-key')

    await client.callGet('/users/me', userSchema)
    client.clearAuth()

    await expect(client.callGet('/users/me', userSchema)).rejects.toBeInstanceOf(CVRAuthError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws CVRAuthError on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'unauthorized' }, 401))
    )
    const client = new TestClient()
    client.setAuth('CVR User', 'access-key')

    await expect(client.callGet('/users/me', userSchema)).rejects.toBeInstanceOf(CVRAuthError)
  })

  it.each([
    new DOMException('The operation timed out', 'TimeoutError'),
    new TypeError('Failed to fetch')
  ])('translates %s into CVRNetworkError', async (networkFailure) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkFailure))
    const client = new TestClient()
    client.setAuth('CVR User', 'access-key')

    const request = client.callGet('/users/me', userSchema)

    await expect(request).rejects.toBeInstanceOf(CVRNetworkError)
    await expect(request).rejects.toMatchObject({
      cause: { cause: networkFailure }
    })
  })

  it('retries 429 responses with exponential backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'slow down' }, 429))
      .mockResolvedValueOnce(
        jsonResponse({ message: 'ok', data: { id: 'user-id', username: 'CVR User' } })
      )
    const sleepSpy = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)
    const client = new TestClient(sleepSpy)
    client.setAuth('CVR User', 'access-key')

    await expect(client.callGet('/users/me', userSchema)).resolves.toMatchObject({ id: 'user-id' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepSpy.mock.calls.some(([ms]) => ms >= 1_000)).toBe(true)
  })

  it('honors Retry-After seconds before retrying', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'slow down' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '2' }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: 'ok', data: { id: 'user-id', username: 'CVR User' } })
      )
    const sleepSpy = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)
    const client = new TestClient(sleepSpy)
    client.setAuth('CVR User', 'access-key')

    await client.callGet('/users/me', userSchema)

    expect(sleepSpy).toHaveBeenCalledWith(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws CVRRateLimitError after three retries', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'slow down' }, 429))
    vi.stubGlobal('fetch', fetchMock)
    const client = new TestClient()
    client.setAuth('CVR User', 'access-key')

    await expect(client.callGet('/users/me', userSchema)).rejects.toMatchObject({
      name: 'CVRRateLimitError',
      retryAfterMs: 8_000
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('uses password auth for first login without authenticated headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'authenticated', data: authData }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new TestClient().callLogin('user@example.com', 'real-password')).resolves.toEqual(
      authData
    )

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${CVR_API_BASE}/users/auth`)
    expect(JSON.parse(options.body)).toEqual({
      AuthType: 2,
      Username: 'user@example.com',
      Password: 'real-password'
    })
    expect(options.headers.Platform).toBe(CVR_PLATFORM)
    expect(options.headers.Username).toBeUndefined()
    expect(options.headers.AccessKey).toBeUndefined()
  })

  it('sends the access key in Password for re-authentication', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'authenticated', data: authData }))
    vi.stubGlobal('fetch', fetchMock)

    await new TestClient().callReauthenticate('CVR User', 'access-key')

    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({
      AuthType: 1,
      Username: 'CVR User',
      Password: 'access-key'
    })
    expect(options.headers.Platform).toBe(CVR_PLATFORM)
  })
})
