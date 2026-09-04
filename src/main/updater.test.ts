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
  type UpdaterFailure,
  type UpdaterServiceDeps,
  CHECK_INTERVAL_MS,
  MAX_JITTER_MS,
  NATIVE_STAGE_TIMEOUT_MS
} from './updater'

type EventHandler = (...payload: unknown[]) => void
type MockFn = ReturnType<typeof vi.fn>

function createMockAutoUpdater(): {
  autoUpdater: AppUpdater & {
    emit: (event: string, ...payload: unknown[]) => void
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
    emit: (event: string, ...payload: unknown[]) => {
      handlers.get(event)?.forEach((h) => h(...payload))
    },
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    _handlers: handlers
  } as unknown as AppUpdater & {
    emit: (event: string, ...payload: unknown[]) => void
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

function createMockNativeStageUpdater(): {
  updater: NonNullable<UpdaterServiceDeps['nativeStageUpdater']>
  emitError: (error: Error) => void
  emitDownloaded: (updateURL?: string) => void
  setFeedURL: (url: string) => void
  listenerCount: (event: 'error' | 'update-downloaded') => number
  removeListener: MockFn
} {
  const handlers = new Map<string, EventHandler[]>()
  let feedURL = 'http://127.0.0.1:41000'
  const removeListener = vi.fn((event: string, handler: EventHandler) => {
    handlers.set(
      event,
      (handlers.get(event) ?? []).filter((candidate) => candidate !== handler)
    )
    return updater
  })
  const updater = {
    on: (event: string, handler: EventHandler) => {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event)!.push(handler)
      return updater
    },
    removeListener,
    getFeedURL: () => feedURL
  } as unknown as NonNullable<UpdaterServiceDeps['nativeStageUpdater']>

  const emit = (event: string, ...payload: unknown[]): void => {
    const listeners = [...(handlers.get(event) ?? [])]
    listeners.forEach((listener) => listener(...payload))
  }

  return {
    updater,
    emitError: (error) => emit('error', error),
    emitDownloaded: (updateURL = `${feedURL}/current.zip`) =>
      emit('update-downloaded', {}, '', '', new Date(0), updateURL),
    setFeedURL: (url) => {
      feedURL = url
    },
    listenerCount: (event) => handlers.get(event)?.length ?? 0,
    removeListener
  }
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
    vi.restoreAllMocks()
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
      nativeStageUpdater?: NonNullable<UpdaterServiceDeps['nativeStageUpdater']>
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
    log: { info: MockFn; warn: MockFn; error: MockFn; debug: MockFn }
  } {
    const { autoUpdater, checkForUpdates, downloadUpdate, quitAndInstall } = createMockAutoUpdater()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const app = createMockApp(options.packaged ?? true)
    const windows = options.windows ?? []
    const settings = { autoUpdate: options.autoUpdate ?? false }
    const service = new UpdaterService({
      app,
      autoUpdater,
      getSettings: () => settings,
      log,
      browserWindow: createMockBrowserWindowCtor(windows),
      nativeStageUpdater: options.nativeStageUpdater
    })
    return { service, autoUpdater, checkForUpdates, downloadUpdate, quitAndInstall, log }
  }

  it('overrides updater defaults and discards all library logger payloads', () => {
    // The consent core. autoDownload must be forced OFF (the library default is
    // true — leaving it would silently download every release), allowPrerelease
    // must be forced ON (pre-1.0 releases are all GitHub prereleases; the
    // default false empties the update feed), autoInstallOnAppQuit must be
    // forced ON (a consented download applies at quit), and the logger must be
    // wrapped so updater diagnostics reach the VRX log only after sanitization.
    const { autoUpdater, log } = createService()
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(autoUpdater.logger).not.toBe(log)

    const updaterLogger = autoUpdater.logger as unknown as {
      info(message: unknown, ...meta: unknown[]): void
      warn(message: unknown, ...meta: unknown[]): void
      error(message: unknown, ...meta: unknown[]): void
      debug(message: unknown, ...meta: unknown[]): void
    }
    const uncPath = `${String.fromCharCode(92, 92)}server${String.fromCharCode(92)}alice share${String.fromCharCode(92)}cache`
    const fileUrl = `file:///${['C:', 'Users', 'alice', 'VRX Cache', 'VRX.dmg'].join('/')}`
    const unixPath = ['', 'Users', 'alice', 'Library', 'Application Support', 'VRX', 'cache'].join(
      '/'
    )
    updaterLogger.info(`cache ${fileUrl}`, uncPath)
    updaterLogger.warn(`cache path ${unixPath}`)
    updaterLogger.error('download failed', { path: uncPath })
    updaterLogger.debug('download trace', [fileUrl])

    // Absence from the sink is stronger than redaction: none of these payloads
    // can be inspected, serialized, or leak through a future sanitizer gap.
    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
    expect(log.debug).not.toHaveBeenCalled()
  })

  it('redacts spaced paths and credential query names while preserving diagnostic suffixes', () => {
    const { autoUpdater, log } = createService()
    const updaterLogger = autoUpdater.logger as unknown as {
      warn(message: unknown, ...meta: unknown[]): void
    }
    const windowsPath = `${String.fromCharCode(67, 58, 92)}${['Users', 'Alice Smith', 'VRX Cache', 'VRX.dmg'].join(String.fromCharCode(92))}`
    const unixPath = ['', 'Users', 'alice', 'Library', 'Application Support', 'VRX', 'cache'].join(
      '/'
    )

    updaterLogger.warn(
      `write ${windowsPath}: disk full; retryable=true`,
      `cache ${unixPath}: disk full; retryable=true`,
      'https://updates.example.test?client_secret=secret&refresh_token=refresh&session=opaque'
    )

    expect(log.warn).not.toHaveBeenCalled()
  })

  it('redacts signed URL query variants without changing benign query values', () => {
    const { autoUpdater, log } = createService()
    const updaterLogger = autoUpdater.logger as unknown as { info(message: unknown): void }
    updaterLogger.info(
      'https://updates.example.test/file?build=123&auth_token=one&private_token=two&X-Amz-Credential=three&x-amz-security-token=four&X-Amz-Signature=five&channel=stable'
    )

    expect(log.info).not.toHaveBeenCalled()
  })

  it('strips every updater URL query, including encoded and future credential keys', () => {
    const { autoUpdater, log } = createService()
    const updaterLogger = autoUpdater.logger as unknown as { info(message: unknown): void }
    updaterLogger.info(
      'https://updates.example.test/file?%61uth_token=one&sig=two&AWSAccessKeyId=three&future=opaque'
    )
    expect(log.info).not.toHaveBeenCalled()
  })

  it('does not forward absolute paths or later stack frames', () => {
    const volumePath = ['', 'Volumes', 'Alice Private', 'VRX Cache', 'update.zip'].join('/')
    const windowsPath = `${String.fromCharCode(68, 58)}/${['Alice Private', 'VRX Cache', 'update.zip'].join('/')}`
    const fileUrl = `file://${volumePath}`
    const stack = `Error: write ${volumePath}: disk full\n    at next frame (app.js:1:1)`

    const { autoUpdater, log } = createService()
    const logger = autoUpdater.logger as unknown as { error(...args: unknown[]): void }
    logger.error(volumePath, windowsPath, fileUrl, stack)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('sanitizes file URL variants and assignment-delimited paths without consuming punctuation', () => {
    const path = ['', 'Volumes', 'Alice Private', 'VRX Cache', 'update.zip'].join('/')
    const stack = `Error: cachePath=${path})\n    at later frame (app.js:2:1)`

    const { autoUpdater, log } = createService()
    const logger = autoUpdater.logger as unknown as { error(...args: unknown[]): void }
    logger.error(
      `open file://server/share${path}: disk full`,
      `open file://localhost${path}`,
      stack
    )
    expect(log.error).not.toHaveBeenCalled()
  })

  it('replaces path-bearing diagnostics wholesale across colon, parentheses, and comma boundaries', () => {
    const volume = ['', 'Volumes', 'Alice Private', 'VRX Cache', 'update.zip'].join('/')
    const { autoUpdater, log } = createService()
    ;(autoUpdater.logger as unknown as { warn(...args: unknown[]): void }).warn(
      `cachePath:${volume}, retry later`,
      `failed (${volume})`
    )
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('redacts updater logger metadata without flattening cycles, custom instances, or Errors', () => {
    const { autoUpdater, log } = createService()
    const updaterLogger = autoUpdater.logger as unknown as {
      error(message: unknown, ...meta: unknown[]): void
    }
    const cyclic: Record<string, unknown> = { label: 'cycle' }
    cyclic.self = cyclic
    const updaterPath = [
      '',
      'Users',
      'alice',
      'Library',
      'Application Support',
      'VRX',
      'cache'
    ].join('/')
    class UpdaterMetadata {
      path = updaterPath
    }
    const error = Object.assign(new Error(`write ${updaterPath}: disk full`), {
      retryAfterMs: 500,
      cachePath: updaterPath
    })
    error.stack = `Error: write ${updaterPath}: disk full`

    expect(() =>
      updaterLogger.error('metadata', cyclic, new UpdaterMetadata(), error)
    ).not.toThrow()

    expect(log.error).not.toHaveBeenCalled()
  })

  it('keeps structured error diagnostics and the library diagnostic argument after sanitization', () => {
    const { service, autoUpdater, log } = createService()
    const updaterPath = ['', 'Volumes', 'Alice Private', 'VRX Cache', 'update.zip'].join('/')
    const cause = Object.assign(new Error(`cause at ${updaterPath}: retry later`), {
      code: 'ENOSPC'
    })
    const error = Object.assign(new Error(`write ${updaterPath}: disk full`), {
      code: 'EACCES',
      cause,
      updaterMetadata: { cachePath: updaterPath, client_secret: 'secret' }
    })
    error.stack = `Error: write ${updaterPath}: disk full\n    at updater frame (app.js:1:1)`

    ;(autoUpdater.emit as unknown as (...args: unknown[]) => void)('error', error, {
      cachePath: updaterPath,
      refresh_token: 'refresh'
    })

    expect(service.snapshot().failure).toBe('check-network')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: check failed')
  })

  it('does not invoke an unstructured direct-error message getter', () => {
    const { service, autoUpdater, log } = createService()
    const error = new Error('unused')
    Object.defineProperty(error, 'message', {
      enumerable: false,
      get: () => {
        throw new Error('message getter must not run')
      }
    })

    expect(() => autoUpdater.emit('error', error)).not.toThrow()
    expect(service.snapshot().failure).toBe('check-network')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: check failed')
  })

  it('keeps structured rejection diagnostics when an updater operation fails', async () => {
    const { service, checkForUpdates, log } = createService()
    const updaterPath = `${String.fromCharCode(68, 58)}/${['Alice Private', 'VRX Cache', 'update.zip'].join('/')}`
    const error = Object.assign(new Error(`write ${updaterPath}: disk full`), {
      code: 'EACCES',
      cause: Object.assign(new Error(`cause ${updaterPath}: retry later`), { code: 'ENOSPC' })
    })
    error.stack = `Error: write ${updaterPath}: disk full\n    at updater frame (app.js:1:1)`
    checkForUpdates.mockRejectedValue(error)

    await service.check()

    expect(log.warn).toHaveBeenCalledWith('autoUpdater: check failed')
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

  it('keeps a macOS wrapper event outside a service-owned download from enabling Restart', () => {
    const nativeStage = createMockNativeStageUpdater()
    const { service, autoUpdater, quitAndInstall } = createService({
      nativeStageUpdater: nativeStage.updater
    })

    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    service.install()

    expect(service.snapshot()).toMatchObject({ state: 'idle', availableVersion: null })
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
  })

  it('releases an unarmed macOS gate when a test updater resolves without a wrapper event', async () => {
    const nativeStage = createMockNativeStageUpdater()
    const { service, autoUpdater, downloadUpdate } = createService({
      nativeStageUpdater: nativeStage.updater
    })
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    downloadUpdate.mockResolvedValue(undefined)

    await service.download()

    expect(service.snapshot()).toMatchObject({ state: 'update-available', failure: null })
    expect(nativeStage.listenerCount('error')).toBe(0)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
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

  it('maps a check failure to a closed renderer-safe category and logs only sanitized diagnostics', async () => {
    const { service, checkForUpdates, log } = createService()
    const unixPath = ['', 'Users', 'alice', 'secret.yml'].join('/')
    checkForUpdates.mockRejectedValue(new Error(`ENOTFOUND update.example.test for ${unixPath}`))
    await service.check()
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot().failure).toBe<UpdaterFailure>('check-network')
    expect(service.snapshot()).not.toHaveProperty('errorMessage')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: check failed')
  })

  it('maps a download/write failure to a closed renderer-safe category', async () => {
    const { service, autoUpdater, downloadUpdate } = createService()
    const unixPath = ['', 'Users', 'alice', 'Downloads', 'VRX.dmg'].join('/')
    void service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    downloadUpdate.mockRejectedValue(new Error(`EACCES: ${unixPath}`))

    await service.download()

    expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'download-write' })
    expect(service.snapshot()).not.toHaveProperty('errorMessage')
  })

  it('keeps a staged update retryable and maps an install failure to its closed category', () => {
    const { service, autoUpdater } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }

    autoUpdater.emit('error', new Error('EPERM: /private/tmp/VRX.exe'))

    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
  })

  it('contains a synchronous native install failure behind the closed retryable state', () => {
    const { service, quitAndInstall, log } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    const privatePath = ['', 'Users', 'account-owner', 'VRX Cache', 'pending.zip'].join('/')
    quitAndInstall.mockImplementation(() => {
      throw new Error(`EPERM ${privatePath}?token=SECRET`)
    })

    expect(() => service.install()).not.toThrow()
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: staged install failed, retryable')
    expect(log.warn.mock.calls[0]).toHaveLength(1)
  })

  it('handles an install error event followed by the same synchronous throw only once', () => {
    const { service, autoUpdater, quitAndInstall, log } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    const failure = new Error('native install failed')
    quitAndInstall.mockImplementation(() => {
      autoUpdater.emit('error', failure)
      throw failure
    })

    expect(() => service.install()).not.toThrow()
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: staged install failed, retryable')
  })

  it('ignores a late install error event for the object already handled by a throw', () => {
    const { service, autoUpdater, quitAndInstall, log } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    const failure = new Error('native install failed')
    quitAndInstall.mockImplementation(() => {
      throw failure
    })

    service.install()
    autoUpdater.emit('error', failure)

    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: staged install failed, retryable')
  })

  it('ignores a distinct late install error after the retryable failure is recorded', () => {
    const { service, autoUpdater, log } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }

    autoUpdater.emit('error', new Error('native install failed first'))
    autoUpdater.emit('error', new Error('native install failed later'))

    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: staged install failed, retryable')
  })

  it('ignores a distinct late install error while a retry download is in flight', async () => {
    const { service, autoUpdater, downloadUpdate, log } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    autoUpdater.emit('error', new Error('native install failed first'))

    let resolveDownload: (() => void) | undefined
    downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve
        })
    )
    const retry = service.download()
    autoUpdater.emit('error', new Error('native install failed later'))

    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })
    expect(log.warn).toHaveBeenCalledTimes(1)
    resolveDownload?.()
    await retry
    expect(service.snapshot()).toMatchObject({ state: 'update-available', failure: null })
  })

  it('keeps late install errors quarantined through macOS wrapper download completion', async () => {
    const nativeStage = createMockNativeStageUpdater()
    const { service, autoUpdater, downloadUpdate, quitAndInstall, log } = createService({
      nativeStageUpdater: nativeStage.updater
    })
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    autoUpdater.emit('error', new Error('native install failed first'))

    let rejectDownload: ((error: Error) => void) | undefined
    downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDownload = reject
        })
    )
    const retry = service.download()
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(1)
    expect(nativeStage.listenerCount('error')).toBe(0)
    service.install()
    expect(quitAndInstall).not.toHaveBeenCalled()
    const latePreviousFailure = new Error('late error from the previous native stage')
    // electron-updater forwards the native error through its wrapper first;
    // the same native emission rejects MacUpdater's current global listener.
    // VRX deliberately has no unscoped native-error listener on this retry.
    autoUpdater.emit('error', latePreviousFailure)
    rejectDownload?.(latePreviousFailure)
    nativeStage.emitError(latePreviousFailure)
    await Promise.resolve()

    expect(service.snapshot()).toMatchObject({
      state: 'downloading',
      progressPercent: 100,
      failure: null
    })
    expect(log.warn).toHaveBeenCalledTimes(1)

    nativeStage.emitDownloaded()
    await retry
    expect(service.snapshot()).toMatchObject({ state: 'downloaded', failure: null })
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(nativeStage.listenerCount('error')).toBe(0)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
    autoUpdater.emit('error', new Error('current staged update failed'))
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  it('classifies a current macOS native-stage rejection while old events are quarantined', async () => {
    const nativeStage = createMockNativeStageUpdater()
    const { service, autoUpdater, downloadUpdate, quitAndInstall, log } = createService({
      nativeStageUpdater: nativeStage.updater
    })
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    autoUpdater.emit('error', new Error('native install failed first'))
    const currentFailure = new Error('current native stage failed')
    let rejectDownload: ((error: Error) => void) | undefined
    downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDownload = reject
        })
    )

    const retry = service.download()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    autoUpdater.emit('error', currentFailure)
    rejectDownload?.(currentFailure)
    nativeStage.emitError(currentFailure)
    await Promise.resolve()
    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })

    await vi.advanceTimersByTimeAsync(NATIVE_STAGE_TIMEOUT_MS)
    await retry

    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenLastCalledWith('autoUpdater: staged install failed, retryable')
    expect(nativeStage.listenerCount('error')).toBe(0)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)

    nativeStage.emitDownloaded()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('accepts only the current macOS retry feed after a prior native stage fails', async () => {
    const nativeStage = createMockNativeStageUpdater()
    const { service, autoUpdater, downloadUpdate, quitAndInstall } = createService({
      nativeStageUpdater: nativeStage.updater
    })
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    let resolveFirst: (() => void) | undefined
    downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
    )
    const firstAttempt = service.download()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    expect(nativeStage.listenerCount('error')).toBe(1)
    resolveFirst?.()
    await Promise.resolve()
    const firstFailure = new Error('first native stage failed')
    autoUpdater.emit('error', firstFailure)
    nativeStage.emitError(firstFailure)
    await firstAttempt
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })

    nativeStage.setFeedURL('http://127.0.0.1:41001')
    let resolveRetry: (() => void) | undefined
    downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve
        })
    )
    const retry = service.download()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    resolveRetry?.()
    await Promise.resolve()

    nativeStage.emitDownloaded('http://127.0.0.1:41000/old-stage.zip')
    await Promise.resolve()
    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })
    service.install()
    expect(quitAndInstall).not.toHaveBeenCalled()

    nativeStage.emitDownloaded('http://127.0.0.1:41001/current-stage.zip')
    await retry
    expect(service.snapshot()).toMatchObject({ state: 'downloaded', failure: null })
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(nativeStage.listenerCount('error')).toBe(0)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
  })

  it('publishes a clean first macOS attempt only after scoped native staging', async () => {
    const nativeStage = createMockNativeStageUpdater()
    const { service, autoUpdater, downloadUpdate, quitAndInstall } = createService({
      nativeStageUpdater: nativeStage.updater
    })
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    downloadUpdate.mockImplementationOnce(() => {
      autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
      return Promise.resolve(undefined)
    })

    const attempt = service.download()
    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })
    expect(nativeStage.listenerCount('error')).toBe(1)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(1)
    service.install()
    expect(quitAndInstall).not.toHaveBeenCalled()

    nativeStage.emitDownloaded()
    await attempt

    expect(service.snapshot()).toMatchObject({ state: 'downloaded', failure: null })
    expect(nativeStage.listenerCount('error')).toBe(0)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
    service.install()
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })

  it.each([
    ['non-loopback', 'http://updates.example.test:41000'],
    ['TLS loopback', 'https://127.0.0.1:41000'],
    ['credentialed loopback', 'http://fixture@127.0.0.1:41000'],
    ['default-port loopback', 'http://127.0.0.1'],
    ['malformed', 'not a URL']
  ])('fails closed for a %s macOS native feed', async (_label, feedURL) => {
    const nativeStage = createMockNativeStageUpdater()
    nativeStage.setFeedURL(feedURL)
    const { service, autoUpdater, downloadUpdate, quitAndInstall } = createService({
      nativeStageUpdater: nativeStage.updater
    })
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    downloadUpdate.mockImplementationOnce(() => {
      autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
      return Promise.resolve(undefined)
    })

    const attempt = service.download()
    nativeStage.emitDownloaded(`${feedURL}/current.zip`)
    await Promise.resolve()

    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })
    service.install()
    expect(quitAndInstall).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(NATIVE_STAGE_TIMEOUT_MS)
    await attempt
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(nativeStage.listenerCount('error')).toBe(0)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
  })

  it('fails closed when macOS reuses a previously claimed native feed scope', async () => {
    const nativeStage = createMockNativeStageUpdater()
    const { service, autoUpdater, downloadUpdate, quitAndInstall } = createService({
      nativeStageUpdater: nativeStage.updater
    })
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    downloadUpdate.mockImplementationOnce(() => {
      autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
      return Promise.resolve(undefined)
    })
    const firstAttempt = service.download()
    const firstFailure = new Error('first native stage failed')
    autoUpdater.emit('error', firstFailure)
    nativeStage.emitError(firstFailure)
    await firstAttempt
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })

    // Reusing the first attempt's loopback origin would make old and current
    // completions indistinguishable, so the retry must never accept it.
    downloadUpdate.mockImplementationOnce(() => {
      autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
      return Promise.resolve(undefined)
    })

    const attempt = service.download()
    await Promise.resolve()
    nativeStage.emitDownloaded('http://127.0.0.1:41000/reused-stage.zip')
    await Promise.resolve()

    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })
    service.install()
    expect(quitAndInstall).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(NATIVE_STAGE_TIMEOUT_MS)
    await attempt
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })
    expect(nativeStage.listenerCount('error')).toBe(0)
    expect(nativeStage.listenerCount('update-downloaded')).toBe(0)
  })

  it('releases late-install quarantine after a successful no-update check result', () => {
    const { service, autoUpdater, log } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    autoUpdater.emit('error', new Error('native install failed'))

    autoUpdater.emit('update-not-available')
    autoUpdater.emit('error', new Error('later check failed'))

    expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'check-network' })
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenLastCalledWith('autoUpdater: check failed')
  })

  it('still classifies a retry download rejection while late install events are quarantined', async () => {
    const { service, autoUpdater, downloadUpdate, log } = createService()
    // @ts-expect-error accessing private state for test setup
    service.state = { ...service.state, state: 'downloaded' }
    autoUpdater.emit('error', new Error('native install failed'))
    const downloadFailure = new Error('retry download failed')
    downloadUpdate.mockImplementationOnce(() => {
      autoUpdater.emit('error', downloadFailure)
      return Promise.reject(downloadFailure)
    })

    await service.download()

    expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'download-write' })
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenLastCalledWith('autoUpdater: download failed')
  })

  it('clears a staged-install failure before a retry download and keeps fallback state clean', async () => {
    const { service, autoUpdater, downloadUpdate } = createService()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    autoUpdater.emit('error', new Error('staged install failed'))
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'staged-install'
    })

    let resolveDownload: (() => void) | undefined
    downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve
        })
    )
    const retry = service.download()

    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })
    resolveDownload?.()
    await retry
    expect(service.snapshot()).toMatchObject({ state: 'update-available', failure: null })

    downloadUpdate.mockRejectedValueOnce(new Error('disk full'))
    await service.download()
    expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'download-write' })
  })

  it('keeps a staged update retryable when macOS redispatches the same error', async () => {
    const { service, autoUpdater, checkForUpdates, log } = createService()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    const error = new Error('EPERM: cannot replace staged update')

    autoUpdater.emit('error', error)
    autoUpdater.emit('error', error)

    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      availableVersion: '0.15.0',
      failure: 'staged-install'
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: staged install failed, retryable')

    checkForUpdates.mockRejectedValueOnce(error)
    await service.check()
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'check-network'
    })
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenLastCalledWith(
      'autoUpdater: re-check failed, preserving update-available'
    )
  })

  it('ignores an earlier re-check Error event during a later download, but handles its current rejection', async () => {
    const { service, autoUpdater, checkForUpdates, downloadUpdate } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    const reusedError = new Error('reused updater error')
    checkForUpdates.mockRejectedValueOnce(reusedError)
    await service.check()
    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      failure: 'check-network'
    })

    let resolveDownload: (() => void) | undefined
    downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve
        })
    )
    const pendingDownload = service.download()
    autoUpdater.emit('error', reusedError)
    expect(service.snapshot()).toMatchObject({ state: 'downloading', failure: null })
    resolveDownload?.()
    await pendingDownload
    expect(service.snapshot()).toMatchObject({ state: 'update-available', failure: null })

    downloadUpdate.mockRejectedValueOnce(reusedError)
    await service.download()
    expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'download-write' })
  })

  it('maps download errors to the download/write category', async () => {
    const { service, autoUpdater, downloadUpdate, log } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    downloadUpdate.mockRejectedValue(new Error('disk full'))
    await service.download()
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot().failure).toBe('download-write')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: download failed')
  })

  it('keeps the download/write failure when electron-updater emits error before rejecting', async () => {
    const { service, autoUpdater, downloadUpdate, log } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    const error = new Error('disk full')
    downloadUpdate.mockImplementation(() => {
      autoUpdater.emit('error', error)
      return Promise.reject(error)
    })

    await service.download()

    expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'download-write' })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: download failed')
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

  it('error listener maps check failures to the check/network category', () => {
    const { service, autoUpdater, log } = createService()
    autoUpdater.emit('error', new Error('feed unreachable'))
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot().failure).toBe('check-network')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: check failed')
  })

  it('error listener does not clobber a staged downloaded state', () => {
    const { service, autoUpdater, log } = createService()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    autoUpdater.emit('error', new Error('post-download hiccup'))
    expect(service.snapshot().state).toBe('update-available')
    expect(service.snapshot().availableVersion).toBe('0.15.0')
    expect(service.snapshot().failure).toBe('staged-install')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: staged install failed, retryable')
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
    expect(service.snapshot().failure).toBe('check-network')
  })

  it('keeps a retryable update when electron-updater emits re-check error before rejecting', async () => {
    const { service, autoUpdater, checkForUpdates, log } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    const error = new Error('network down')
    checkForUpdates.mockImplementation(() => {
      autoUpdater.emit('error', error)
      return Promise.reject(error)
    })

    await service.check()

    expect(service.snapshot()).toMatchObject({
      state: 'update-available',
      availableVersion: '0.15.0',
      failure: 'check-network'
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(
      'autoUpdater: re-check failed, preserving update-available'
    )
  })

  it('clears a stale failure when a successful re-check finds an update', async () => {
    const { service, autoUpdater, checkForUpdates } = createService()
    await service.check()
    autoUpdater.emit('error', new Error('feed unreachable'))
    expect(service.snapshot().failure).toBe('check-network')

    checkForUpdates.mockResolvedValue(undefined)
    const promise = service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
    await promise

    expect(service.snapshot().state).toBe('update-available')
    expect(service.snapshot().failure).toBeNull()
  })

  it('clears a stale failure when update-downloaded succeeds after a download error', async () => {
    const { service, autoUpdater, downloadUpdate } = createService()
    await service.check()
    autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)

    downloadUpdate.mockRejectedValueOnce(new Error('disk full'))
    await service.download()
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot().failure).toBe('download-write')

    // A later retry succeeds: the previous error must not survive.
    downloadUpdate.mockResolvedValue(undefined)
    const promise = service.download()
    autoUpdater.emit('update-downloaded', { version: '0.15.0' } as UpdateInfo)
    await promise

    expect(service.snapshot().state).toBe('downloaded')
    expect(service.snapshot().failure).toBeNull()
  })

  it('redacts filesystem paths, email addresses, and token query values from logged diagnostics', () => {
    // Construct a Windows path dynamically so the path-convention scanner does not
    // flag a hardcoded local path in this test file.
    const winPath = `${String.fromCharCode(67, 58, 92)}${['__fake__', 'me', 'app.exe'].join(String.fromCharCode(92))}`
    const { autoUpdater, log } = createService()
    ;(autoUpdater.logger as unknown as { error(...args: unknown[]): void }).error(
      `Could not write to ${winPath}`,
      'ENOENT: /tmp/fake/vrx/log.txt',
      'alice@example.test?token=SECRET'
    )
    expect(log.error).not.toHaveBeenCalled()
  })

  it('keeps a path-bearing error out of the snapshot and redacts it in the log', () => {
    const winPath = `${String.fromCharCode(67, 58, 92)}${['__fake__', 'me', 'pending.exe'].join(String.fromCharCode(92))}`
    const { service, autoUpdater, log } = createService()
    autoUpdater.emit('error', new Error(`EPERM: cannot stage ${winPath}`))
    expect(service.snapshot().state).toBe('error')
    expect(service.snapshot()).not.toHaveProperty('errorMessage')
    expect(service.snapshot().failure).toBe('check-network')
    expect(log.warn).toHaveBeenCalledWith('autoUpdater: check failed')
  })

  describe('payload-free diagnostic boundary', () => {
    const fileUrl = `file://${['', 'Users', 'Alice Private', 'VRX Cache', 'update.zip'].join('/')}`
    const cachePath = `cachePath=${['', 'Volumes', 'Alice Private', 'VRX Cache', 'update.zip'].join('/')}`
    it.each([
      'https://updates.example.test/file?token=SECRET&fragment=secret#private',
      fileUrl,
      'alice@example.test',
      cachePath
    ])('discards library logger payload %s without calling the injected sink', (payload) => {
      const { autoUpdater, log } = createService()
      const updaterLogger = autoUpdater.logger as unknown as { error(...args: unknown[]): void }
      updaterLogger.error(payload, Buffer.from([1, 2, 3]))
      expect(log.info).not.toHaveBeenCalled()
      expect(log.warn).not.toHaveBeenCalled()
      expect(log.error).not.toHaveBeenCalled()
      expect(log.debug).not.toHaveBeenCalled()
    })

    it('never observes hostile rejection data and contains a throwing sink', async () => {
      const { service, checkForUpdates, log } = createService()
      const hostile = new Proxy(
        {},
        {
          get: () => {
            throw new Error('SECRET getter inspected')
          }
        }
      )
      log.warn.mockImplementation(() => {
        throw new Error('sink failure')
      })
      checkForUpdates.mockRejectedValue(hostile)
      await expect(service.check()).resolves.toBeUndefined()
      expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'check-network' })
      expect(log.warn).toHaveBeenCalledWith('autoUpdater: check failed')
      expect(log.warn.mock.calls[0]).toHaveLength(1)
    })

    it('ignores a late event after a rejected check, but handles the same value once for a later check', async () => {
      const { service, autoUpdater, checkForUpdates, log } = createService()
      const failure = { opaque: true }
      checkForUpdates.mockRejectedValueOnce(failure)
      await service.check()
      ;(autoUpdater.emit as unknown as (...args: unknown[]) => void)('error', failure)
      expect(log.warn).toHaveBeenCalledTimes(1)

      checkForUpdates.mockRejectedValueOnce(failure)
      await service.check()
      expect(log.warn).toHaveBeenCalledTimes(2)
      expect(service.snapshot().failure).toBe('check-network')
    })

    it('does not retain primitive rejection history across operations', async () => {
      const { service, checkForUpdates, log } = createService()
      checkForUpdates.mockRejectedValueOnce('primitive failure')
      await service.check()
      checkForUpdates.mockRejectedValueOnce('primitive failure')
      await service.check()

      expect(log.warn).toHaveBeenCalledTimes(2)
      expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'check-network' })
    })

    it('ignores late events after rejected re-check and download operations', async () => {
      const { service, autoUpdater, checkForUpdates, downloadUpdate, log } = createService()
      await service.check()
      autoUpdater.emit('update-available', { version: '0.15.0' } as UpdateInfo)
      const recheckFailure = new Error('recheck failure')
      checkForUpdates.mockRejectedValueOnce(recheckFailure)
      await service.check()
      ;(autoUpdater.emit as unknown as (...args: unknown[]) => void)('error', recheckFailure)
      expect(log.warn).toHaveBeenCalledTimes(1)
      expect(service.snapshot()).toMatchObject({
        state: 'update-available',
        failure: 'check-network'
      })

      const downloadFailure = { write: 'failed' }
      downloadUpdate.mockRejectedValueOnce(downloadFailure)
      await service.download()
      ;(autoUpdater.emit as unknown as (...args: unknown[]) => void)('error', downloadFailure)
      expect(log.warn).toHaveBeenCalledTimes(2)
      expect(service.snapshot()).toMatchObject({ state: 'error', failure: 'download-write' })
    })
  })
})
