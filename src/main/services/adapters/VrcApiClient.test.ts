import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { VRC_API_BASE } from '@shared/constants'
import type { AuthStatus, LoginResult } from '@shared/types'
import type { FriendRoster, Unsubscribe } from './IPlatformAdapter'
import { AuthError } from './errors'
import { VrcApiClient } from './VrcApiClient'
import { jsonResponse, instantAdmission } from './__testutils__/adapterTestKit'

type SentRequest = { method: string; headers: Record<string, string>; body?: string }

const userSchema = z.object({ id: z.string(), displayName: z.string() })

/** Exposes the protected client methods; stubs the IPlatformAdapter contract (VrcAdapter's job, not under test here). */
class TestClient extends VrcApiClient {
  public constructor() {
    super(instantAdmission())
  }
  callGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.get(path, schema)
  }
  callPost<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.post(path, body, schema)
  }
  callPut<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.put(path, schema)
  }
  callPutJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.putJson(path, body, schema)
  }
  callDelete<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.delete(path, schema)
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
  clearSession(): void {
    return
  }
  getFriends(): Promise<FriendRoster> {
    throw new Error('stub')
  }
  buildJoinUrl(): string | null {
    return null
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

  it('PUTs without a body, or with a JSON body through putJson', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const client = new TestClient()

    await client.callPut('/avatars/avtr_1/select', z.unknown())
    await client.callPutJson(
      '/auth/user/unplayermoderate',
      { moderated: 'usr_1', type: 'block' },
      z.unknown()
    )

    const [, bare] = fetchMock.mock.calls[0]! as unknown as [string, SentRequest]
    expect(bare.method).toBe('PUT')
    expect(bare.body).toBeUndefined()
    expect(bare.headers['Content-Type']).toBeUndefined()
    const [url, withBody] = fetchMock.mock.calls[1]! as unknown as [string, SentRequest]
    expect(url).toBe(`${VRC_API_BASE}/auth/user/unplayermoderate`)
    expect(withBody.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(withBody.body!)).toEqual({ moderated: 'usr_1', type: 'block' })
  })

  it('DELETEs VRC_API_BASE + path with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: { status_code: 200 } }))
    vi.stubGlobal('fetch', fetchMock)

    await new TestClient().callDelete('/auth/user/friends/usr_1', z.unknown())

    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VRC_API_BASE}/auth/user/friends/usr_1`)
    expect(options.method).toBe('DELETE')
    expect(options.body).toBeUndefined()
    expect(options.headers['User-Agent']).toMatch(/^VRX\//)
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
