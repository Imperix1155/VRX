import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send
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

async function exposedBridge(): Promise<{
  getFriends: (request: { platform: 'vrchat' }) => Promise<unknown>
  getSettings: () => Promise<unknown>
  onIdentityBoundary: (callback: (payload: { platform: 'vrchat' }) => void) => () => void
}> {
  Object.defineProperty(process, 'contextIsolated', { configurable: true, value: true })
  await import('./index')
  return electron.exposeInMainWorld.mock.calls[0]?.[1]
}

describe('preload identity-boundary bridge', () => {
  it('subscribes, forwards the payload, and unsubscribes the same listener', async () => {
    const bridge = await exposedBridge()
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

describe('preload invoke error normalization', () => {
  it('converts Electron-wrapped rate-limit denials into the renderer contract', async () => {
    electron.invoke.mockRejectedValueOnce(
      new Error("Error invoking remote method 'get-settings': Error: rate_limited")
    )
    const bridge = await exposedBridge()

    await expect(bridge.getSettings()).rejects.toMatchObject({
      name: 'Error',
      message: 'rate_limited'
    })
  })

  it('normalizes the same wrapped denial for non-settings invoke channels', async () => {
    electron.invoke.mockRejectedValueOnce(
      new Error("Error invoking remote method 'get-friends': Error: rate_limited")
    )
    const bridge = await exposedBridge()

    await expect(bridge.getFriends({ platform: 'vrchat' })).rejects.toMatchObject({
      message: 'rate_limited'
    })
  })
})
