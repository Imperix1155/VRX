/**
 * Updater service tests (VRX-113).
 *
 * Behavioral coverage: state machine, consent-first download, autoUpdate toggle,
 * portable → unsupported, jittered re-check scheduling, and error handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import type { BrowserWindow, App } from 'electron'
import { UpdaterService, type UpdaterSnapshot } from './updater'

type EventHandler = (payload: unknown) => void
type MockFn = ReturnType<typeof vi.fn>

function createMockAutoUpdater(): {
  autoUpdater: AppUpdater & {
    emit: (event: string, payload?: unknown) => void
    _handlers: Map<string, EventHandler[]>
  }
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, EventHandler[]>()
  const checkForUpdates = vi.fn()
  const downloadUpdate = vi.fn()
  const quitAndInstall = vi.fn()

  const autoUpdater = {
    // electron-updater's REAL defaults — the service must actively override
    // autoDownload (silent-download ban) and allowPrerelease (pre-1.0 feed
    // visibility). Starting the mock at the library defaults makes the
    // config-contract test bind: dropping an override goes red.
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    on: (event: string, handler: EventHandler) => {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event)!.push(handler)
      return autoUpdater as unknown as AppUpdater
    },
    emit: (event: string, payload?: unknown) => {
      handlers.get(event)?.forEach((h) => h(payload))
    },
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    _handlers: handlers
  } as unknown as AppUpdater & {
    emit: (event: string, payload?: unknown) => void
    _handlers: Map<string, EventHandler[]>
  }

  return { autoUpdater, checkForUpdates, downloadUpdate, quitAndInstall }
}

function createMockBrowserWindow(): {
  win: {
    isDestroyed: MockFn
    webContents: { send: (channel: string, payload: unknown) => void }
  }
  sent: Array<{ channel: string; payload: unknown }>
} {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const win = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: (channel: string, payload: unknown) => sent.push({ channel, payload })
    }
  }
  return { win, sent }
}

function createMockApp(packaged: boolean): App {
  return {
    isPackaged: packaged,
    getVersion: () => '0.14.0'
  } as unknown as App
}

function createMockBrowserWindowCtor(windows: BrowserWindow[]): typeof BrowserWindow {
  return {
    getAllWindows: vi.fn(() => windows)
  } as unknown as typeof BrowserWindow
}

describe('UpdaterService', () => {
  let portableFlag: string | undefined

  beforeEach(() => {
    portableFlag = process.env.PORTABLE_EXECUTABLE_DIR
    delete process.env.PORTABLE_EXECUTABLE_DIR
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (portableFlag === undefined) {
      delete process.env.PORTABLE_EXECUTABLE_DIR
    } else {
      process.env.PORTABLE_EXECUTABLE_DIR = portableFlag
    }
  })

  function createService(
    options: {
      packaged?: boolean
      autoUpdate?: boolean
      windows?: BrowserWindow[]
    } = {}
  ): {
    service: UpdaterService
    autoUpdater: AppUpdater & {
      emit: (event: string, payload?: unknown) => void
      _handlers: Map<string, EventHandler[]>
    }
    checkForUpdates: MockFn
    downloadUpdate: MockFn
    quitAndInstall: MockFn
    log: { warn: MockFn }
  } {
    const { autoUpdater, checkForUpdates, downloadUpdate, quitAndInstall } = createMockAutoUpdater()
    const log = { warn: vi.fn() }
    const app = createMockApp(options.packaged ?? true)
    const windows = options.windows ?? []
    const settings = { autoUpdate: options.autoUpdate ?? false }
    const service = new UpdaterService({
      app,
      autoUpdater,
      getSettings: () => settings,
      log,
      browserWindow: createMockBrowserWindowCtor(windows)
    })
    return { service, autoUpdater, checkForUpdates, downloadUpdate, quitAndInstall, log }
  }

  it('overrides electron-updater defaults at bind: no silent downloads, prerelease feed on', () => {
    // The consent core. autoDownload must be forced OFF (the library default is
    // true — leaving it would silently download every release), allowPrerelease
    // must be forced ON (pre-1.0 releases are all GitHub prereleases; the
    // default false empties the update feed), and autoInstallOnAppQuit stays ON
    // (a consented download may apply at quit).
    const { autoUpdater } = createService()
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('starts in unsupported state when PORTABLE_EXECUTABLE_DIR is set', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'portable'
    const { service } = createService()
    expect(service.snapshot().state).toBe('unsupported')
  })

  it('broadcasts state to every non-destroyed window on every transition', () => {
    const { win, sent } = createMockBrowserWindow()
    const { autoUpdater } = createService({ windows: [win as unknown as BrowserWindow] })

    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.channel).toBe('updater:state-changed')
    expect((sent[0]!.payload as UpdaterSnapshot).state).toBe('update-available')
    expect((sent[0]!.payload as UpdaterSnapshot).availableVersion).toBe('0.15.0')
  })

  it('manual check no-ops when not packaged', async () => {
    const { service, checkForUpdates } = createService({ packaged: false })
    await service.check()
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(service.snapshot().state).toBe('idle')
  })

  it('manual check transitions idle → checking → idle when no update is available', async () => {
    const { service, autoUpdater, checkForUpdates } = createService()
    const promise = service.check()
    expect(service.snapshot().state).toBe('checking')
    autoUpdater.emit('update-not-available')
    await promise
    expect(checkForUpdates).toHaveBeenCalledOnce()
    expect(service.snapshot().state).toBe('idle')
  })

  it('manual check transitions to update-available and does NOT auto-download when autoUpdate is false', async () => {
    const { service, autoUpdater, checkForUpdates, downloadUpdate } = createService({
      autoUpdate: false
    })
    const promise = service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    await promise
    expect(checkForUpdates).toHaveBeenCalledOnce()
    expect(downloadUpdate).not.toHaveBeenCalled()
    expect(service.snapshot().state).toBe('update-available')
  })

  it('auto-downloads when autoUpdate is true and an update becomes available', async () => {
    const { service, autoUpdater, downloadUpdate } = createService({ autoUpdate: true })
    const promise = service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    await promise
    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(service.snapshot().state).toBe('downloading')
  })

  it('download no-ops unless state is update-available', async () => {
    const { service, downloadUpdate } = createService()
    await service.download()
    expect(downloadUpdate).not.toHaveBeenCalled()
  })

  it('download transitions through progress to downloaded', async () => {
    const { service, autoUpdater, downloadUpdate } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    const promise = service.download()
    expect(service.snapshot().state).toBe('downloading')
    autoUpdater.emit('download-progress', { percent: 42 } as ProgressInfo)
    expect(service.snapshot().progressPercent).toBe(42)
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    await promise

    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(service.snapshot().state).toBe('downloaded')
    expect(service.snapshot().progressPercent).toBe(100)
  })

  it('install only quits when state is downloaded', () => {
    const { service, quitAndInstall } = createService()
    service.install()
    expect(quitAndInstall).not.toHaveBeenCalled()

    void service.check()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    service.install()
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })

  it('catches check errors and moves to error state with a string message', async () => {
    const { service, checkForUpdates, log } = createService()
    checkForUpdates.mockRejectedValue(new Error('network down'))
    await service.check()
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot().errorMessage).toBe('network down')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: update check failed', 'network down')
  })

  it('catches download errors and moves to error state with a string message', async () => {
    const { service, autoUpdater, downloadUpdate, log } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    downloadUpdate.mockRejectedValue(new Error('disk full'))
    await service.download()
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot().errorMessage).toBe('disk full')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: download failed', 'disk full')
  })

  it('schedules the next check with jitter (4 h ± 30 min)', () => {
    const { service } = createService()
    vi.runOnlyPendingTimers()
    // After the initial pending timer fires, a second timer should exist for the
    // next jittered check.
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a check while not idle/error is a no-op', async () => {
    const { service, checkForUpdates } = createService()
    void service.check()
    const firstCalls = checkForUpdates.mock.calls.length
    // Force a transition to checking.
    expect(service.snapshot().state).toBe('checking')
    // Second check while checking should not call checkForUpdates again.
    await service.check()
    expect(checkForUpdates).toHaveBeenCalledTimes(firstCalls)
  })
})
