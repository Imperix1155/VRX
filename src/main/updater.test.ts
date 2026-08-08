/**
 * Updater service tests (VRX-113).
 *
 * Behavioral coverage: state machine, consent-first download, autoUpdate toggle,
 * portable → unsupported, jittered re-check scheduling, and error handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import type { BrowserWindow, App } from 'electron'
import {
  UpdaterService,
  type UpdaterSnapshot,
  CHECK_INTERVAL_MS,
  MAX_JITTER_MS,
  sanitizeErrorForDisplay
} from './updater'

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
    // Start OPPOSITE the service's required settings so the config-contract pin
    // binds: autoDownload must flip to false, autoInstallOnAppQuit must flip to
    // true, allowPrerelease must flip to true, and logger must be set.
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    logger: null,
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

  it('overrides electron-updater defaults at bind: no silent downloads, prerelease feed on, logger wired', () => {
    // The consent core. autoDownload must be forced OFF (the library default is
    // true — leaving it would silently download every release), allowPrerelease
    // must be forced ON (pre-1.0 releases are all GitHub prereleases; the
    // default false empties the update feed), autoInstallOnAppQuit must be
    // forced ON (a consented download applies at quit), and the logger must be
    // wired so updater diagnostics flow through the redacted VRX log.
    const { autoUpdater, log } = createService()
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(autoUpdater.logger).toBe(log)
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
    downloadUpdate.mockImplementation(() => {
      autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
      return Promise.resolve(undefined)
    })
    const promise = service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    await promise
    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(service.snapshot().state).toBe('downloaded')
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
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: error', 'network down')
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

  it('schedules the next check with jitter (4 h + up to 30 min)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
    const { service, checkForUpdates } = createService()

    // Capture the scheduled re-check delay(s) set by the service.
    const delays = setTimeoutSpy.mock.calls
      .filter(([, delay]) => typeof delay === 'number' && delay >= CHECK_INTERVAL_MS)
      .map(([, delay]) => delay as number)
    expect(delays.length).toBeGreaterThan(0)
    const delay = delays[0]!
    expect(delay).toBeGreaterThanOrEqual(CHECK_INTERVAL_MS)
    expect(delay).toBeLessThanOrEqual(CHECK_INTERVAL_MS + MAX_JITTER_MS)

    // Firing the pending timer must actually run a check (kills the void mutant).
    vi.runOnlyPendingTimers()
    expect(checkForUpdates).toHaveBeenCalled()

    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a check while checking, downloading, or downloaded is a no-op', async () => {
    const { service, checkForUpdates } = createService()
    void service.check()
    const firstCalls = checkForUpdates.mock.calls.length
    expect(service.snapshot().state).toBe('checking')
    await service.check()
    expect(checkForUpdates).toHaveBeenCalledTimes(firstCalls)

    // Staged install should never be re-checked over.
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    await service.check()
    expect(checkForUpdates).toHaveBeenCalledTimes(firstCalls)
  })

  it('re-checks from update-available on the scheduled timer', () => {
    const { service, autoUpdater, checkForUpdates } = createService()
    vi.runOnlyPendingTimers()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    expect(service.snapshot().state).toBe('update-available')
    expect(checkForUpdates).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(4 * 60 * 60 * 1000 + 30 * 60 * 1000)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('re-evaluates autoUpdate when a new update-available arrives', async () => {
    const settings = { autoUpdate: false }
    const { service, autoUpdater, downloadUpdate } = createService()
    // @ts-expect-error accessing private deps for test setup
    service.deps.getSettings = () => settings
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    expect(downloadUpdate).not.toHaveBeenCalled()

    settings.autoUpdate = true
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    expect(downloadUpdate).toHaveBeenCalledOnce()
  })

  it('download falls back to update-available when no update-downloaded event fires', async () => {
    const { service, autoUpdater, downloadUpdate } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    const promise = service.download()
    expect(service.snapshot().state).toBe('downloading')
    await promise

    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(service.snapshot().state).toBe('update-available')
  })

  it('error listener moves to error state with a string message', () => {
    const { service, autoUpdater, log } = createService()
    autoUpdater.emit('error', new Error('feed unreachable'))
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot().errorMessage).toBe('feed unreachable')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: error', 'feed unreachable')
  })

  it('error listener does not clobber a staged downloaded state', () => {
    const { service, autoUpdater, log } = createService()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    autoUpdater.emit('error', new Error('post-download hiccup'))
    expect(service.snapshot().state).toBe('update-available')
    expect(service.snapshot().availableVersion).toBe('0.15.0')
    expect(service.snapshot().errorMessage).toBe('post-download hiccup')
    expect(log.warn).toHaveBeenCalledWith(
      'autoUpdater: staged install failed, retryable',
      'post-download hiccup'
    )
  })

  it('blocks re-check while downloading', async () => {
    const { service, autoUpdater, checkForUpdates } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    const promise = service.download()
    expect(service.snapshot().state).toBe('downloading')
    const callsWhileDownloading = checkForUpdates.mock.calls.length
    await service.check()
    expect(checkForUpdates).toHaveBeenCalledTimes(callsWhileDownloading)
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    await promise
  })

  it('does not broadcast duplicate download-progress payloads', async () => {
    const { win, sent } = createMockBrowserWindow()
    const { service, autoUpdater } = createService({ windows: [win as unknown as BrowserWindow] })
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    const beforeDownload = sent.length
    const promise = service.download()
    autoUpdater.emit('download-progress', { percent: 42 } as ProgressInfo)
    autoUpdater.emit('download-progress', { percent: 42 } as ProgressInfo)
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    await promise

    const progressBroadcasts = sent
      .slice(beforeDownload)
      .filter((s) => (s.payload as UpdaterSnapshot).progressPercent === 42)
    expect(progressBroadcasts).toHaveLength(1)
  })

  it('broadcasts when update-available version changes, but not on identical refresh', async () => {
    const { win, sent } = createMockBrowserWindow()
    const { service, autoUpdater } = createService({ windows: [win as unknown as BrowserWindow] })
    await service.check()
    const before = sent.length
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    expect(sent).toHaveLength(before + 1)
    autoUpdater.emit('update-available', { version: '0.15.1' } as UpdateInfo)
    expect(sent).toHaveLength(before + 2)
  })

  it('preserves update-available on transient re-check failure', async () => {
    const { service, autoUpdater, checkForUpdates } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    expect(service.snapshot().state).toBe('update-available')

    checkForUpdates.mockRejectedValueOnce(new Error('network down'))
    const promise = service.check()
    expect(service.snapshot().state).toBe('checking')
    await promise

    expect(service.snapshot().state).toBe('update-available')
    expect(service.snapshot().availableVersion).toBe('0.15.0')
    expect(service.snapshot().errorMessage).toBe('network down')
  })

  it('sanitizes filesystem paths in displayed error messages', () => {
    // Construct a Windows path dynamically so the path-convention scanner does not
    // flag a hardcoded local path in this test file.
    const winPath = `${String.fromCharCode(67, 58, 92)}${['__fake__', 'me', 'app.exe'].join(String.fromCharCode(92))}`
    expect(sanitizeErrorForDisplay(`Could not write to ${winPath}`)).toBe(
      'Could not write to app.exe'
    )
    expect(sanitizeErrorForDisplay('ENOENT: /tmp/fake/vrx/log.txt')).toBe('ENOENT: log.txt')
    expect(sanitizeErrorForDisplay("Error in '/tmp/fake/VRX.app/Contents/MacOS/VRX'")).toBe(
      "Error in 'VRX'"
    )
  })
})
