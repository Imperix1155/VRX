/**
 * Consent-based auto-update service (VRX-113).
 *
 * Reworks the previous silent auto-update flow into an explicit state machine:
 * - Never download or install without user consent.
 * - Packaged builds only; dev and portable NSIS builds are unsupported.
 * - Jittered periodic re-check (~4 h + up to 30 min) via a setTimeout chain.
 * - State transitions broadcast to every renderer window on `updater:state-changed`.
 */
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import log from './logger'
import { getSettingsSnapshot } from './services/settings'
import type { UpdaterFailure, UpdaterSnapshot, UpdaterState } from '@shared/ipc'

export type { UpdaterFailure, UpdaterSnapshot, UpdaterState }

interface UpdaterLogger {
  info(message?: unknown, ...meta: unknown[]): void
  warn(message?: unknown, ...meta: unknown[]): void
  error(message?: unknown, ...meta: unknown[]): void
  debug?(message?: unknown, ...meta: unknown[]): void
}

interface AutoUpdateSettings {
  autoUpdate: boolean
}

interface NativeStageUpdater {
  once(event: 'update-downloaded', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'update-downloaded', listener: () => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
}

interface NativeStageGate {
  promise: Promise<void>
  arm(): void
  releaseIfUnarmed(): void
  cancel(): void
}

export interface UpdaterServiceDeps {
  app: typeof app
  autoUpdater: AppUpdater
  getSettings: () => AutoUpdateSettings
  log: UpdaterLogger
  browserWindow: typeof BrowserWindow
  /** Electron's native macOS updater, used only to prove Squirrel finished staging. */
  nativeStageUpdater?: NativeStageUpdater
}

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
export const MAX_JITTER_MS = 30 * 60 * 1000 // 0–30 minutes

function isPortable(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_DIR
}

/** electron-updater diagnostics are third-party payloads: discard them wholesale. */
const DISCARDED_UPDATER_LOGGER: UpdaterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
}

// Object identities are retained weakly so a late electron-updater event from a
// completed operation cannot be misclassified during a later one. Rejection
// primitives deliberately have no cross-operation history: updater events are
// Error objects, while catches can reject with any JavaScript value.
const HANDLED_UPDATER_ERROR_OBJECTS = new WeakSet<object>()

function createNativeStageGate(updater: NativeStageUpdater): NativeStageGate {
  let armed = false
  let settled = false
  let resolveGate!: () => void
  let rejectGate!: (reason?: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolveGate = resolve
    rejectGate = reject
  })

  function cleanup(): void {
    updater.removeListener('update-downloaded', onDownloaded)
    updater.removeListener('error', onError)
  }

  function settle(completion: () => void): void {
    if (settled) return
    settled = true
    cleanup()
    completion()
  }

  function onDownloaded(): void {
    settle(resolveGate)
  }

  function onError(error: Error): void {
    settle(() => rejectGate(error))
  }

  return {
    promise,
    arm: () => {
      if (armed || settled) return
      armed = true
      // electron-updater emits its wrapper event immediately before asking
      // Electron's native Squirrel updater to stage the downloaded archive.
      updater.once('update-downloaded', onDownloaded)
      updater.once('error', onError)
    },
    releaseIfUnarmed: () => {
      // Test doubles and nonstandard updater implementations can resolve without
      // a wrapper event. Preserve the existing retryable fallback instead of hanging.
      if (!armed) settle(resolveGate)
    },
    cancel: () => settle(resolveGate)
  }
}

export class UpdaterService {
  private state: UpdaterSnapshot
  private checkTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  private checkOrigin: UpdaterState | null = null
  private eventHandledError: unknown = undefined
  private hasEventHandledError = false
  private installErrorEventQuarantine = false
  private downloadInFlight = false
  private pendingDownloadedInfo: UpdateInfo | null = null
  private nativeStageGate: NativeStageGate | null = null

  constructor(private readonly deps: UpdaterServiceDeps) {
    this.state = {
      state: isPortable() ? 'unsupported' : 'idle',
      currentVersion: deps.app.getVersion(),
      availableVersion: null,
      progressPercent: 0,
      failure: null
    }
    this.bindAutoUpdater()
    if (this.state.state !== 'unsupported') {
      this.scheduleNextCheck()
    }
  }

  private bindAutoUpdater(): void {
    const { autoUpdater } = this.deps
    autoUpdater.autoDownload = false
    // A consented download applies when VRX next closes; Restart applies it now.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = DISCARDED_UPDATER_LOGGER
    // The release pipeline deliberately publishes every pre-1.0 release as a GitHub
    // PRERELEASE (release.yml). electron-updater's allowPrerelease defaults to false
    // for a stable version string like "0.1.1", which filters ALL of our releases out
    // of the update feed — auto-update would never find anything. Allow prereleases
    // until 1.0; when releases stop being marked prerelease, this line can go.
    autoUpdater.allowPrerelease = true

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({
        state: 'update-available',
        availableVersion: info.version,
        failure: null
      })
      this.checkOrigin = null
      if (this.deps.getSettings().autoUpdate) {
        void this.download()
      }
    })

    autoUpdater.on('update-not-available', () => {
      this.installErrorEventQuarantine = false
      this.setState({ state: 'idle', availableVersion: null, failure: null })
      this.checkOrigin = null
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setState({ progressPercent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      if (this.downloadInFlight) {
        // MacUpdater emits this wrapper event before native Squirrel staging
        // settles. Arm a native-only gate before MacUpdater starts that stage.
        this.pendingDownloadedInfo = info
        this.nativeStageGate?.arm()
        this.setState({ progressPercent: 100, failure: null })
        return
      }
      // A macOS wrapper event outside a service-owned download cannot prove the
      // native updater is ready, so it must never enable Restart on its own.
      if (this.deps.nativeStageUpdater) return
      this.publishDownloaded(info)
    })

    autoUpdater.on('error', (err: Error) => {
      // Native install failures can be redispatched later under distinct Error
      // objects. Current check/download operations still reject their promises,
      // so their catch paths own classification while this quarantine is active.
      if (this.installErrorEventQuarantine) return
      if (this.isPreviouslyHandledObject(err) || this.wasHandledByCurrentEvent(err)) return
      this.rememberCurrentEvent(err)
      this.handleError()
      this.rememberHandledObject(err)
    })
  }

  private logUpdaterWarning(label: string): void {
    try {
      this.deps.log.warn(label)
    } catch {
      // Logging is observability only; never let a sink alter updater state.
    }
  }

  private handleError(): void {
    if (this.pendingDownloadedInfo !== null || this.state.state === 'downloaded') {
      this.installErrorEventQuarantine = true
      // Staged install failed: return to update-available so the user can retry.
      this.setState({
        state: 'update-available',
        availableVersion: this.pendingDownloadedInfo?.version ?? this.state.availableVersion,
        failure: 'staged-install'
      })
      this.logUpdaterWarning('autoUpdater: staged install failed, retryable')
      return
    }
    if (this.state.state === 'downloading') {
      this.handleDownloadError()
      return
    }
    this.handleCheckError()
  }

  private handleCheckError(): void {
    if (this.checkOrigin === 'update-available') {
      // Re-check failed transiently: keep the existing update visible.
      this.setState({ state: 'update-available', failure: 'check-network' })
      this.checkOrigin = null
      this.logUpdaterWarning('autoUpdater: re-check failed, preserving update-available')
      return
    }
    this.setState({ state: 'error', failure: 'check-network' })
    this.logUpdaterWarning('autoUpdater: check failed')
  }

  private handleDownloadError(): void {
    this.setState({ state: 'error', failure: 'download-write' })
    this.logUpdaterWarning('autoUpdater: download failed')
  }

  private publishDownloaded(info: UpdateInfo): void {
    this.installErrorEventQuarantine = false
    this.setState({
      state: 'downloaded',
      availableVersion: info.version,
      progressPercent: 100,
      failure: null
    })
  }

  private setState(next: Partial<UpdaterSnapshot>): void {
    const merged = { ...this.state, ...next }
    if (this.isEqualSnapshot(this.state, merged)) return
    this.state = merged
    this.broadcast()
  }

  private isEqualSnapshot(a: UpdaterSnapshot, b: UpdaterSnapshot): boolean {
    return (
      a.state === b.state &&
      a.currentVersion === b.currentVersion &&
      a.availableVersion === b.availableVersion &&
      a.progressPercent === b.progressPercent &&
      a.failure === b.failure
    )
  }

  private broadcast(): void {
    const { browserWindow } = this.deps
    for (const win of browserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('updater:state-changed', this.snapshot())
      }
    }
  }

  private scheduleNextCheck(): void {
    if (this.disposed) return
    if (this.checkTimer) clearTimeout(this.checkTimer)
    const jitter = Math.floor(Math.random() * (MAX_JITTER_MS + 1))
    this.checkTimer = setTimeout(() => {
      void this.check()
      this.scheduleNextCheck()
    }, CHECK_INTERVAL_MS + jitter)
  }

  snapshot(): UpdaterSnapshot {
    return { ...this.state }
  }

  private beginOperationErrorTracking(): void {
    this.eventHandledError = undefined
    this.hasEventHandledError = false
  }

  private wasHandledByCurrentEvent(error: unknown): boolean {
    return this.hasEventHandledError && this.eventHandledError === error
  }

  private rememberCurrentEvent(error: unknown): void {
    this.eventHandledError = error
    this.hasEventHandledError = true
  }

  private isPreviouslyHandledObject(error: unknown): boolean {
    return typeof error === 'object' && error !== null && HANDLED_UPDATER_ERROR_OBJECTS.has(error)
  }

  private rememberHandledObject(error: unknown): void {
    if (typeof error === 'object' && error !== null) HANDLED_UPDATER_ERROR_OBJECTS.add(error)
  }

  async check(): Promise<void> {
    if (!this.deps.app.isPackaged) return
    if (this.state.state === 'unsupported') return
    // A check while genuinely in-flight or already staged is a no-op.
    if (
      this.state.state === 'checking' ||
      this.state.state === 'downloading' ||
      this.state.state === 'downloaded'
    ) {
      return
    }

    if (isPortable()) {
      this.setState({ state: 'unsupported' })
      return
    }

    this.checkOrigin = this.state.state
    this.beginOperationErrorTracking()
    this.setState({ state: 'checking', failure: null })
    try {
      await this.deps.autoUpdater.checkForUpdates()
      // 'update-not-available' / 'update-available' / 'error' events drive the
      // final state. If checkForUpdates resolves without firing an event (some
      // test doubles), fall back to idle so the machine doesn't stall.
      // Use snapshot() because event handlers may have moved state asynchronously.
      if (this.snapshot().state === 'checking') {
        this.setState({ state: 'idle', availableVersion: null })
      }
    } catch (err) {
      if (!this.wasHandledByCurrentEvent(err)) {
        this.handleError()
        this.rememberHandledObject(err)
      }
    } finally {
      this.checkOrigin = null
    }
  }

  async download(): Promise<void> {
    if (!this.deps.app.isPackaged) return
    if (this.state.state !== 'update-available') return
    if (isPortable()) return

    this.setState({ state: 'downloading', progressPercent: 0, failure: null })
    this.beginOperationErrorTracking()
    this.downloadInFlight = true
    this.pendingDownloadedInfo = null
    const nativeStageGate = this.deps.nativeStageUpdater
      ? createNativeStageGate(this.deps.nativeStageUpdater)
      : null
    this.nativeStageGate = nativeStageGate
    try {
      const downloadPromise = this.deps.autoUpdater.downloadUpdate()
      if (nativeStageGate) {
        const libraryCompletion = Promise.resolve(downloadPromise).then((result) => {
          nativeStageGate.releaseIfUnarmed()
          return result
        })
        await Promise.all([libraryCompletion, nativeStageGate.promise])
      } else {
        await downloadPromise
      }
      const downloadedInfo = this.pendingDownloadedInfo
      if (this.snapshot().state === 'downloading' && downloadedInfo !== null) {
        this.publishDownloaded(downloadedInfo)
      }
      // 'update-downloaded' event drives the final state. If it resolved without
      // firing the event (some test doubles), fall back so the machine doesn't stall.
      if (this.snapshot().state === 'downloading') {
        this.setState({ state: 'update-available', progressPercent: 0, failure: null })
      }
    } catch (err) {
      if (!this.wasHandledByCurrentEvent(err)) {
        this.handleError()
        this.rememberHandledObject(err)
      }
    } finally {
      nativeStageGate?.cancel()
      if (this.nativeStageGate === nativeStageGate) this.nativeStageGate = null
      this.downloadInFlight = false
      this.pendingDownloadedInfo = null
    }
  }

  install(): void {
    if (!this.deps.app.isPackaged) return
    if (this.state.state !== 'downloaded') return
    this.beginOperationErrorTracking()
    try {
      this.deps.autoUpdater.quitAndInstall()
    } catch (error) {
      // A synchronous native failure must not cross IPC. If electron-updater
      // already emitted its error event, that handler has moved state for us.
      if (this.snapshot().state === 'downloaded') this.handleError()
      this.rememberHandledObject(error)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.checkTimer = undefined
  }
}

let updaterService: UpdaterService | undefined

export function initAutoUpdater(): UpdaterService {
  if (!updaterService) {
    updaterService = new UpdaterService({
      app,
      autoUpdater: electronUpdater.autoUpdater,
      getSettings: getSettingsSnapshot,
      log,
      browserWindow: BrowserWindow,
      nativeStageUpdater: process.platform === 'darwin' ? nativeAutoUpdater : undefined
    })
  }
  return updaterService
}

export function getUpdaterService(): UpdaterService {
  if (!updaterService) {
    throw new Error('Updater service has not been initialized')
  }
  return updaterService
}
