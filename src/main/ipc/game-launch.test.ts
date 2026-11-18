import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { GameLaunchResult } from '@shared/ipc'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => true) }))

import { registerGameLaunchHandlers } from './game-launch'
import { isTrustedIpcSender } from './security'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const start = vi.fn<(platform: string) => Promise<GameLaunchResult>>()
const log = vi.fn()
const launch = (req: unknown): unknown => handlers.get('launch-game')!(event, req)

beforeEach(() => {
  handlers.clear()
  start.mockReset().mockResolvedValue({ ok: true, state: 'started' })
  log.mockReset()
  vi.mocked(isTrustedIpcSender).mockReturnValue(true)
  registerGameLaunchHandlers({ start }, log)
})

describe('launch-game handler', () => {
  it.each(['vrchat', 'chilloutvr'])(
    'starts %s and returns what the launcher says',
    async (platform) => {
      await expect(launch({ platform })).resolves.toEqual({ ok: true, state: 'started' })
      expect(start).toHaveBeenCalledExactlyOnceWith(platform)
      expect(log).not.toHaveBeenCalled()
    }
  )

  it('passes the launcher only the platform, whatever else the request holds', async () => {
    await launch({ platform: 'vrchat', url: 'steam://rungameid/1', appId: 1, args: '--x' })
    expect(start).toHaveBeenCalledExactlyOnceWith('vrchat')
  })

  it('refuses an untrusted sender before anything starts', async () => {
    vi.mocked(isTrustedIpcSender).mockReturnValue(false)
    await expect(launch({ platform: 'vrchat' })).rejects.toThrow('Untrusted IPC sender')
    expect(start).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    null,
    'vrchat',
    {},
    { platform: 'steam' },
    { platform: '__proto__' },
    { platform: ['vrchat'] },
    { platform: 438100 }
  ])('refuses a request that names no known platform: %j', async (req) => {
    await expect(launch(req)).rejects.toThrow('Invalid launch-game request')
    expect(start).not.toHaveBeenCalled()
  })

  it('logs a refusal with the platform and reason only', async () => {
    start.mockResolvedValue({ ok: false, reason: 'launch-failed' })
    await expect(launch({ platform: 'chilloutvr' })).resolves.toEqual({
      ok: false,
      reason: 'launch-failed'
    })
    expect(log).toHaveBeenCalledExactlyOnceWith('game launch denied', {
      platform: 'chilloutvr',
      reason: 'launch-failed'
    })
  })
})
