import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod'
import type { AuthStatus, Friend, InstanceInfo, LoginResult } from '@shared/types'
import type { Unsubscribe } from './IPlatformAdapter'
import { CvrApiClient } from './CvrApiClient'
import { VRC_USER_AGENT } from './VrcApiClient'
import { jsonResponse, noopSleep } from './__testutils__/adapterTestKit'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }
const expectedUserAgent = `VRX/${pkg.version} (https://github.com/Imperix1155/VRX)`

const userSchema = z.object({ id: z.string(), username: z.string() })

/** Exposes the protected CVR GET method so the test can observe real headers. */
class TestCvrClient extends CvrApiClient {
  constructor() {
    super(noopSleep)
  }
  callGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.get(path, schema)
  }
  setAuth(username: string, accessKey: string): void {
    this.setCredentials({ username, accessKey })
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
  importSession(): Promise<boolean> {
    throw new Error('stub')
  }
  getFriends(): Promise<Friend[]> {
    throw new Error('stub')
  }
  getInstanceDetails(): Promise<InstanceInfo> {
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

describe('User-Agent matches package version', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exports the VRChat User-Agent built from package.json', () => {
    expect(VRC_USER_AGENT).toBe(expectedUserAgent)
  })

  it('sends the ChilloutVR User-Agent built from package.json', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'ok', data: { id: 'u', username: 'U' } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new TestCvrClient()
    client.setAuth('U', 'key')
    await client.callGet('/users/me', userSchema)

    const [, options] = fetchMock.mock.calls[0]!
    expect(options.headers['User-Agent']).toBe(expectedUserAgent)
  })
})
