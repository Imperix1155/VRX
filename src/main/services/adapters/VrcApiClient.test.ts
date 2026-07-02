import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { VRC_API_BASE } from '@shared/constants'
import type { AuthStatus, Friend, InstanceInfo, LoginResult } from '@shared/types'
import type { Unsubscribe } from './IPlatformAdapter'
import { AuthError } from './errors'
import { VrcApiClient } from './VrcApiClient'
import { jsonResponse, noopSleep } from './__testutils__/adapterTestKit'

const userSchema = z.object({ id: z.string(), displayName: z.string() })

/** Exposes the protected client methods; stubs the IPlatformAdapter contract (VrcAdapter's job, not under test here). */
class TestClient extends VrcApiClient {
  public constructor() {
    super(noopSleep)
  }
  callGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.get(path, schema)
  }
  callPost<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.post(path, body, schema)
  }
  setCookie(cookie: string | null): void {
    this.setAuthCookie(cookie)
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

describe('VrcApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs VRC_API_BASE + path with a User-Agent and no cookie by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'usr_1', displayName: 'A' }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await new TestClient().callGet('/auth/user', userSchema)

    expect(user).toEqual({ id: 'usr_1', displayName: 'A' })
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VRC_API_BASE}/auth/user`)
    expect(options.method).toBe('GET')
    expect(options.headers['User-Agent']).toMatch(/^VRX\//)
    expect(options.headers.Cookie).toBeUndefined()
  })

  it('attaches the auth cookie once set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'usr_1', displayName: 'A' }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new TestClient()
    client.setCookie('auth=authcookie_test')
    await client.callGet('/auth/user', userSchema)

    expect(fetchMock.mock.calls[0]![1].headers.Cookie).toBe('auth=authcookie_test')
  })

  it('POSTs a JSON body with a Content-Type header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'usr_1', displayName: 'A' }))
    vi.stubGlobal('fetch', fetchMock)

    await new TestClient().callPost(
      '/auth/twofactorauth/totp/verify',
      { code: '123456' },
      userSchema
    )

    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VRC_API_BASE}/auth/twofactorauth/totp/verify`)
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.body).toBe(JSON.stringify({ code: '123456' }))
  })

  it('throws a typed AuthError on 401 (never a raw response)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))
    await expect(new TestClient().callGet('/auth/user', userSchema)).rejects.toBeInstanceOf(
      AuthError
    )
  })
})
