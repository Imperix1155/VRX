import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()
const openExternal = vi.hoisted(() => vi.fn())
const openPath = vi.hoisted(() => vi.fn())
const logFile = vi.hoisted(() => ({ path: '/data/VRX/logs/main.log' }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  },
  shell: { openExternal, openPath }
}))

vi.mock('../logger', () => ({ getLogFilePath: () => logFile.path }))

vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => true) }))

import { registerLaunchHandlers } from './launch'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent

beforeEach(() => {
  handlers.clear()
  openExternal.mockReset().mockResolvedValue(undefined)
  openPath.mockReset().mockResolvedValue('')
  logFile.path = '/data/VRX/logs/main.log'
  registerLaunchHandlers()
})

describe('open-url handler', () => {
  it.each([
    'vrchat://launch?ref=vrchat.com&id=wrld_example:1',
    'chilloutvr://instance/join?instanceId=i%2Bbab275f822c020a0-152002-e81321-1fe976f9&startInVR=true'
  ])('makes custom schemes unreachable from the renderer-facing path', async (url) => {
    await expect(handlers.get('open-url')!(event, { url })).rejects.toThrow('URL not allowed')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('still opens allowlisted HTTPS URLs', async () => {
    const url = 'https://vrchat.com/home'
    await expect(handlers.get('open-url')!(event, { url })).resolves.toBeUndefined()
    expect(openExternal).toHaveBeenCalledWith(url)
  })
})

describe('open-logs-folder handler', () => {
  it("opens the logger's own directory, ignoring any renderer payload", async () => {
    await expect(
      handlers.get('open-logs-folder')!(event, { path: '/etc' })
    ).resolves.toBeUndefined()
    expect(openPath).toHaveBeenCalledWith('/data/VRX/logs')
  })

  it('rejects when the OS cannot open the folder', async () => {
    openPath.mockResolvedValue('Failed to open path')
    await expect(handlers.get('open-logs-folder')!(event, undefined)).rejects.toThrow(
      'Could not open logs folder'
    )
  })

  it('rejects before the logger is initialised', async () => {
    logFile.path = ''
    await expect(handlers.get('open-logs-folder')!(event, undefined)).rejects.toThrow(
      'Log file unavailable'
    )
    expect(openPath).not.toHaveBeenCalled()
  })
})
