import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener
  }
}))

const originalContextIsolated = Object.getOwnPropertyDescriptor(process, 'contextIsolated')

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  if (originalContextIsolated) {
    Object.defineProperty(process, 'contextIsolated', originalContextIsolated)
  } else {
    Reflect.deleteProperty(process, 'contextIsolated')
  }
})

describe('preload identity-boundary bridge', () => {
  it('subscribes, forwards the payload, and unsubscribes the same listener', async () => {
    Object.defineProperty(process, 'contextIsolated', { configurable: true, value: true })
    await import('./index')

    const bridge = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      onIdentityBoundary: (callback: (payload: { platform: 'vrchat' }) => void) => () => void
    }
    const callback = vi.fn()
    const unsubscribe = bridge.onIdentityBoundary(callback)
    const listener = electron.on.mock.calls.find(
      ([channel]) => channel === 'identity-boundary'
    )?.[1] as (event: unknown, payload: { platform: 'vrchat' }) => void

    listener({}, { platform: 'vrchat' })
    expect(callback).toHaveBeenCalledWith({ platform: 'vrchat' })

    unsubscribe()
    expect(electron.removeListener).toHaveBeenCalledWith('identity-boundary', listener)
  })
})
