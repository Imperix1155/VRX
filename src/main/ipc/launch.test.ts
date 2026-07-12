import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()
const openExternal = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  },
  shell: { openExternal }
}))

vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => true) }))

import { registerLaunchHandlers } from './launch'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent

beforeEach(() => {
  handlers.clear()
  openExternal.mockReset().mockResolvedValue(undefined)
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
