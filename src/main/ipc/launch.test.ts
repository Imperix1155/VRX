import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()
const openExternal = vi.hoisted(() => vi.fn())
const openPath = vi.hoisted(() => vi.fn())
const logFile = vi.hoisted(() => ({ path: '/data/VRX/logs/main.log' }))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.3.0-dev.1', isPackaged: true },
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  },
  shell: { openExternal, openPath }
}))

vi.mock('node:os', () => ({ release: () => '10.0.22631', arch: () => 'x64' }))

vi.mock('../logger', () => ({ getLogFilePath: () => logFile.path }))

vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => true) }))

import { registerLaunchHandlers } from './launch'
import { isTrustedIpcSender } from './security'

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

describe('open-bug-report handler', () => {
  it('opens the prefilled bug report form, ignoring any renderer payload', async () => {
    await expect(
      handlers.get('open-bug-report')!(event, { url: 'https://example.com' })
    ).resolves.toBeUndefined()
    expect(openExternal).toHaveBeenCalledOnce()
    const url = new URL(openExternal.mock.calls[0]?.[0] as string)
    expect(url.origin + url.pathname).toBe('https://github.com/Imperix1155/VRX/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('1.3.0-dev.1')
  })

  it('refuses an untrusted sender before opening anything', async () => {
    vi.mocked(isTrustedIpcSender).mockReturnValueOnce(false)
    await expect(handlers.get('open-bug-report')!(event, undefined)).rejects.toThrow(
      'Untrusted IPC sender'
    )
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('reports the failure when the OS cannot open a browser ', async () => {
    openExternal.mockRejectedValue(new Error('no browser'))
    await expect(handlers.get('open-bug-report')!(event, undefined)).rejects.toThrow()
  })
})
