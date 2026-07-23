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

/** Extract the `key: { ... }` block from config source by brace counting. */
function extractConfigBlock(code: string, key: string): string | null {
  const start = code.indexOf(`${key}:`)
  if (start === -1) return null
  const braceStart = code.indexOf('{', start)
  if (braceStart === -1) return null
  let depth = 1
  let i = braceStart + 1
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') depth--
    i++
  }
  return code.slice(braceStart, i)
}

const electronViteConfig = readFileSync(resolve('electron.vite.config.ts'), 'utf-8')
// Strip block comments first — the file narrates __APP_VERSION__ in prose;
// matching prose would pin nothing (same pattern as designTokens.test.ts:221).
const configNoComments = electronViteConfig
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

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

  it('pins that the main process build defines __APP_VERSION__ (production regression guard)', () => {
    const mainBlock = extractConfigBlock(configNoComments, 'main')
    expect(mainBlock).not.toBeNull()
    expect(mainBlock!).toContain('__APP_VERSION__')
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
