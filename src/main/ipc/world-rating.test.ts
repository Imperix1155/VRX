import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { WorldRatingService } from '../services/worldRatingService'

const { handlers, trusted } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, request: unknown) => unknown>(),
  trusted: { value: true }
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, request: unknown) => unknown) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: () => trusted.value }))
import { registerWorldRatingHandlers } from './world-rating'

const event = { senderFrame: {} } as IpcMainInvokeEvent
const service = {
  getWorldRating: vi.fn(() => Promise.resolve({ ok: true, value: null })),
  setWorldRating: vi.fn(() => Promise.resolve({ ok: true, value: 'like' as const }))
}
const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  vi.clearAllMocks()
  registerWorldRatingHandlers(service as unknown as WorldRatingService)
})

describe('World rating IPC boundary', () => {
  it('guards both channels before parsing or delegating', () => {
    trusted.value = false
    expect(() => call('get-world-rating', { platform: 'vrchat', worldRef: 'ref' })).toThrow(
      'Untrusted IPC sender'
    )
    expect(() =>
      call('set-world-rating', { platform: 'vrchat', worldRef: 'ref', value: 'like' })
    ).toThrow('Untrusted IPC sender')
    expect(service.getWorldRating).not.toHaveBeenCalled()
    expect(service.setWorldRating).not.toHaveBeenCalled()
  })

  it('takes a platform and a bounded reference, and a rating only on the write', () => {
    for (const req of [
      null,
      {},
      { platform: 'steam', worldRef: 'ref' },
      { platform: 'vrchat', worldRef: '' },
      { platform: 'vrchat', worldRef: 'x'.repeat(129) },
      { platform: 'vrchat', worldRef: 'ref', worldId: 'wrld_x' },
      { platform: 'vrchat', worldRef: 'ref', value: 'like' }
    ]) {
      expect(() => call('get-world-rating', req)).toThrow()
    }
    for (const req of [
      null,
      { platform: 'vrchat', worldRef: 'ref' },
      { platform: 'vrchat', worldRef: 'ref', value: 'love' },
      { platform: 'vrchat', worldRef: 'ref', value: 'like', worldId: 'wrld_x' }
    ]) {
      expect(() => call('set-world-rating', req)).toThrow()
    }
    expect(service.getWorldRating).not.toHaveBeenCalled()
    expect(service.setWorldRating).not.toHaveBeenCalled()

    void call('get-world-rating', { platform: 'vrchat', worldRef: 'ref' })
    void call('set-world-rating', { platform: 'vrchat', worldRef: 'ref', value: 'dislike' })
    void call('set-world-rating', { platform: 'vrchat', worldRef: 'ref', value: null })
    expect(service.getWorldRating).toHaveBeenCalledWith('vrchat', 'ref')
    expect(service.setWorldRating).toHaveBeenNthCalledWith(1, 'vrchat', 'ref', 'dislike')
    expect(service.setWorldRating).toHaveBeenNthCalledWith(2, 'vrchat', 'ref', null)
  })
})
