/**
 * Lazy updater load (startup performance). electron-updater's module graph must
 * stay off the path to the first window: nothing loads it until initAutoUpdater,
 * every caller shares one load, and state reads before it answer from the same
 * initial snapshot the service starts in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const loads = vi.hoisted(() => ({ count: 0 }))
const autoUpdater = vi.hoisted(() => ({
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3', isPackaged: false },
  autoUpdater: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('electron-updater', () => {
  loads.count += 1
  return { default: { autoUpdater } }
})
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./services/settings', () => ({ getSettingsSnapshot: () => ({ autoUpdate: true }) }))

import { getUpdaterService, getUpdaterSnapshot, initAutoUpdater } from './updater'

afterEach(() => {
  vi.useRealTimers()
})

describe('lazy updater load', () => {
  it('answers state reads before the load and loads electron-updater once on first use', async () => {
    vi.useFakeTimers()
    expect(loads.count).toBe(0)
    expect(getUpdaterSnapshot()).toEqual({
      state: 'idle',
      currentVersion: '1.2.3',
      availableVersion: null,
      progressPercent: 0,
      failure: null
    })
    expect(() => getUpdaterService()).toThrow('Updater service has not been initialized')
    expect(loads.count).toBe(0)

    const first = initAutoUpdater()
    const second = initAutoUpdater()
    expect(second).toBe(first)
    const service = await first
    expect(loads.count).toBe(1)
    expect(getUpdaterService()).toBe(service)
    expect(getUpdaterSnapshot()).toEqual(service.snapshot())
    expect(autoUpdater.on).toHaveBeenCalled()
  })
})
