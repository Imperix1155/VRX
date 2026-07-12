/**
 * ipc/auth handler boundary tests (2026-07 audit W6).
 *
 * The handlers are captured via a mocked ipcMain.handle, then invoked directly
 * with hostile/malformed payloads. Pins: sender-guard rejection, platform
 * validation, credential shape validation (including the W3 twoFactorCode
 * type check), and clean delegation on the happy path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AuthStatus, Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { stubPlatformAdapter } from '../services/adapters/__testutils__/adapterTestKit'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({
  isTrustedIpcSender: vi.fn(() => trusted.value)
}))

const log = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('electron-log', () => ({ default: log }))

import { registerAuthHandlers } from './auth'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent

let adapter: IPlatformAdapter
const createLoginSuccessMock = (): ReturnType<typeof vi.fn<(platform: Platform) => void>> =>
  vi.fn<(platform: Platform) => void>()
let onLoginSuccess = createLoginSuccessMock()
let onAuthStatus = vi.fn<(status: AuthStatus) => void>()

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  adapter = stubPlatformAdapter()
  onLoginSuccess = createLoginSuccessMock()
  onAuthStatus = vi.fn<(status: AuthStatus) => void>()
  registerAuthHandlers(new Map<Platform, IPlatformAdapter>([['vrchat', adapter]]), {
    onLoginSuccess,
    onAuthStatus
  })
})

const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)

describe('login handler boundary', () => {
  const validReq = {
    platform: 'vrchat',
    credentials: { username: 'neo', password: 'redpill' }
  }

  it('rejects an untrusted sender before touching the payload', () => {
    trusted.value = false
    expect(() => call('login', validReq)).toThrow('Untrusted IPC sender')
    expect(adapter.login).not.toHaveBeenCalled()
  })

  it.each([
    ['null request', null],
    ['unknown platform', { ...validReq, platform: 'steam' }],
    ['missing credentials', { platform: 'vrchat' }],
    ['non-string username', { platform: 'vrchat', credentials: { username: 1, password: 'x' } }],
    ['non-string password', { platform: 'vrchat', credentials: { username: 'x', password: 1 } }],
    [
      'non-string twoFactorCode (W3)',
      { platform: 'vrchat', credentials: { username: 'x', password: 'y', twoFactorCode: 123456 } }
    ]
  ])('rejects %s', (_label, req) => {
    expect(() => call('login', req)).toThrow('Invalid login request')
    expect(adapter.login).not.toHaveBeenCalled()
  })

  it('accepts a valid request and delegates to the adapter', async () => {
    await expect(call('login', validReq)).resolves.toEqual({ ok: true })
    expect(adapter.login).toHaveBeenCalledWith(validReq.credentials)
    expect(onLoginSuccess).toHaveBeenCalledWith('vrchat')
  })

  it('does not reset alert state when login fails', async () => {
    vi.mocked(adapter.login).mockResolvedValue({
      ok: false,
      needs2fa: false,
      error: 'invalid_credentials'
    })

    await expect(call('login', validReq)).resolves.toMatchObject({ ok: false })
    expect(onLoginSuccess).not.toHaveBeenCalled()
  })

  it('accepts an omitted twoFactorCode and a string one', async () => {
    await call('login', validReq)
    await call('login', {
      platform: 'vrchat',
      credentials: { ...validReq.credentials, twoFactorCode: '123456' }
    })
    expect(adapter.login).toHaveBeenCalledTimes(2)
  })

  it('rejects a platform with no registered adapter', () => {
    expect(() => call('login', { ...validReq, platform: 'chilloutvr' })).toThrow(
      'No adapter registered'
    )
  })
})

describe('verify-2fa handler boundary', () => {
  it('rejects a non-string code', () => {
    expect(() => call('verify-2fa', { platform: 'vrchat', code: 123456 })).toThrow(
      'Invalid verify-2fa request'
    )
    expect(adapter.verify2fa).not.toHaveBeenCalled()
  })

  it('delegates a valid code', async () => {
    await expect(call('verify-2fa', { platform: 'vrchat', code: '123456' })).resolves.toEqual({
      ok: true
    })
    expect(adapter.verify2fa).toHaveBeenCalledWith('123456')
    expect(onLoginSuccess).toHaveBeenCalledWith('vrchat')
  })

  it('rejects an untrusted sender', () => {
    trusted.value = false
    expect(() => call('verify-2fa', { platform: 'vrchat', code: '123456' })).toThrow(
      'Untrusted IPC sender'
    )
  })
})

describe('get-auth-status handler boundary', () => {
  it('rejects an invalid platform', () => {
    expect(() => call('get-auth-status', { platform: 'evil' })).toThrow('Invalid platform')
  })

  it('rejects an untrusted sender', () => {
    trusted.value = false
    expect(() => call('get-auth-status', { platform: 'vrchat' })).toThrow('Untrusted IPC sender')
  })

  it('delegates to the adapter for a valid request', async () => {
    await expect(call('get-auth-status', { platform: 'vrchat' })).resolves.toMatchObject({
      state: 'unauthenticated'
    })
    expect(adapter.getAuthStatus).toHaveBeenCalledTimes(1)
  })

  it('publishes the settled auth status for account-registry adoption', async () => {
    const status: AuthStatus = {
      platform: 'vrchat',
      state: 'authenticated',
      accountId: 'usr_a',
      displayName: 'Alice'
    }
    vi.mocked(adapter.getAuthStatus).mockResolvedValue(status)

    await call('get-auth-status', { platform: 'vrchat' })

    expect(onAuthStatus).toHaveBeenCalledWith(status)
  })

  it('logs an account-registry rejection without propagating it', async () => {
    const status: AuthStatus = {
      platform: 'vrchat',
      state: 'authenticated',
      accountId: 'usr_a',
      displayName: 'Alice'
    }
    vi.mocked(adapter.getAuthStatus).mockResolvedValue(status)
    onAuthStatus.mockImplementation(() => {
      throw new Error('account registry rejection')
    })

    await expect(call('get-auth-status', { platform: 'vrchat' })).resolves.toEqual(status)

    expect(log.warn).toHaveBeenCalledWith(
      'onAuthStatus callback failed for vrchat: account registry rejection'
    )
  })
})

describe('logout handler boundary', () => {
  it('rejects an untrusted sender before touching the payload', () => {
    trusted.value = false
    const req = Object.defineProperty({}, 'platform', {
      get: vi.fn(() => 'vrchat')
    })

    expect(() => call('logout', req)).toThrow('Untrusted IPC sender')
    expect(Object.getOwnPropertyDescriptor(req, 'platform')?.get).not.toHaveBeenCalled()
    expect(adapter.clearSession).not.toHaveBeenCalled()
  })

  it.each([null, {}, { platform: 'steam' }])('rejects a malformed request: %o', (req) => {
    expect(() => call('logout', req)).toThrow('Invalid logout request')
    expect(adapter.clearSession).not.toHaveBeenCalled()
  })

  it('rejects a platform with no registered adapter', () => {
    expect(() => call('logout', { platform: 'chilloutvr' })).toThrow('No adapter registered')
  })

  it('delegates only to the requested platform adapter', () => {
    const vrcAdapter = stubPlatformAdapter({ platform: 'vrchat' })
    const cvrAdapter = stubPlatformAdapter({ platform: 'chilloutvr' })
    handlers.clear()
    registerAuthHandlers(
      new Map<Platform, IPlatformAdapter>([
        ['vrchat', vrcAdapter],
        ['chilloutvr', cvrAdapter]
      ])
    )

    expect(call('logout', { platform: 'chilloutvr' })).toBeUndefined()
    expect(cvrAdapter.clearSession).toHaveBeenCalledTimes(1)
    expect(vrcAdapter.clearSession).not.toHaveBeenCalled()
  })

  it('propagates credential deletion failure so the renderer invoke rejects', () => {
    vi.mocked(adapter.clearSession).mockImplementation(() => {
      throw new Error('credential deletion failed')
    })

    expect(() => call('logout', { platform: 'vrchat' })).toThrow('credential deletion failed')
  })
})
