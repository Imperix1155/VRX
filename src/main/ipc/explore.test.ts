import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { ExploreService } from '../services/exploreService'

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
import { registerExploreHandlers } from './explore'

const event = { senderFrame: {} } as IpcMainInvokeEvent
const service = {
  setActive: vi.fn(),
  getSnapshot: vi.fn(),
  getWorld: vi.fn(),
  cancelWorld: vi.fn(),
  getImage: vi.fn(),
  joinRoom: vi.fn()
}
const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  vi.clearAllMocks()
  registerExploreHandlers(service as unknown as ExploreService)
})

describe('Explore IPC boundary', () => {
  it.each([
    'set-explore-active',
    'get-explore',
    'get-explore-world',
    'cancel-explore-world',
    'get-explore-image',
    'join-explore-room'
  ])('guards %s before parsing or delegating', (channel) => {
    trusted.value = false
    expect(() => call(channel, null)).toThrow('Untrusted IPC sender')
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
  })
  it('rejects arbitrary URLs, targets, unknown platforms and unbounded selection strings', () => {
    for (const req of [
      null,
      {},
      { platform: 'steam', reason: 'manual' },
      { platform: 'vrchat', reason: 'retry' }
    ]) {
      expect(() => call('get-explore', req)).toThrow()
    }
    expect(() =>
      call('get-explore-image', {
        platform: 'vrchat',
        worldRef: 'ref',
        url: 'https://example.test'
      })
    ).toThrow()
    expect(() =>
      call('join-explore-room', { platform: 'vrchat', selectionRef: 'x'.repeat(129), mode: 'vr' })
    ).toThrow()
    expect(() =>
      call('join-explore-room', {
        platform: 'vrchat',
        selectionRef: 'ref',
        mode: 'vr',
        worldId: 'forged'
      })
    ).toThrow()
    expect(() =>
      call('set-explore-active', { platforms: ['vrchat', 'vrchat', 'vrchat'] })
    ).toThrow()
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
  })
  it('delegates cache-only reads and opaque action selections without inventing upstream targets', () => {
    call('get-explore', { platform: 'vrchat', reason: 'snapshot' })
    call('get-explore-world', { platform: 'chilloutvr', worldRef: 'world-ref', reason: 'open' })
    call('cancel-explore-world', { platform: 'chilloutvr', worldRef: 'world-ref' })
    call('get-explore-image', { platform: 'vrchat', worldRef: 'world-ref' })
    call('join-explore-room', { platform: 'chilloutvr', selectionRef: 'room-ref', mode: 'vr' })
    call('set-explore-active', { platforms: ['vrchat', 'vrchat'] })
    expect(service.getSnapshot).toHaveBeenCalledWith('vrchat', 'snapshot')
    expect(service.getWorld).toHaveBeenCalledWith('chilloutvr', 'world-ref', 'open')
    expect(service.cancelWorld).toHaveBeenCalledWith('chilloutvr', 'world-ref')
    expect(service.getImage).toHaveBeenCalledWith('vrchat', 'world-ref')
    expect(service.joinRoom).toHaveBeenCalledWith('chilloutvr', 'room-ref', 'vr')
    expect(service.setActive).toHaveBeenCalledWith(['vrchat'])
  })
})
