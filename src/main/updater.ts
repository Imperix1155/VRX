/**
 * Consent-based auto-update service (VRX-113).
 *
 * Reworks the previous silent auto-update flow into an explicit state machine:
 * - Never download or install without user consent.
 * - Packaged builds only; dev and portable NSIS builds are unsupported.
 * - Jittered periodic re-check (~4 h + up to 30 min) via a setTimeout chain.
 * - State transitions broadcast to every renderer window on `updater:state-changed`.
 */
import {
  app,
  autoUpdater as nativeAutoUpdater,
  BrowserWindow,
  type Event as ElectronEvent
} from 'electron'
import { CancellationError, CancellationToken } from 'builder-util-runtime'
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import log from './logger'
import { getSettingsSnapshot } from './services/settings'
import { normalizeUpdateChannel, updateFeedFor, versionAllowedOnChannel } from './updateFeed'
import type { UpdateChannel } from '@shared/types'
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
  /** Parsed by the main process. Unknown values are treated as stable. */
  updateChannel?: unknown
}

type NativeDownloadedListener = (
  event: ElectronEvent,
  releaseNotes: string,
  releaseName: string,
  releaseDate: Date,
  updateURL: string
) => void

interface NativeStageUpdater {
  on(event: 'update-downloaded', listener: NativeDownloadedListener): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'update-downloaded', listener: NativeDownloadedListener): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  getFeedURL(): string
}

interface NativeStageGate {
  promise: Promise<void>
  arm(): void
  shouldDeferLibraryFailure(): boolean
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
export const NATIVE_STAGE_TIMEOUT_MS = 5 * 60 * 1000
/** The launch check waits until the window and first account reads are underway. */
export const STARTUP_CHECK_DELAY_MS = 5_000

function isPortable(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_DIR
}

function initialSnapshot(electronApp: Pick<typeof app, 'getVersion'>): UpdaterSnapshot {
  return {
    state: isPortable() ? 'unsupported' : 'idle',
    currentVersion: electronApp.getVersion(),
    availableVersion: null,
    progressPercent: 0,
    failure: null
  }
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
const NATIVE_STAGE_TIMEOUT = Symbol('native-stage-timeout')

function nativeStageScope(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.port === '' ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

function createNativeStageGate(
  updater: NativeStageUpdater,
  claimedScopes: Set<string>,
  ignoreNativeErrors: boolean
): NativeStageGate {
  let armed = false
  let settled = false
  let expectedScope: string | null = null
  let timeout: ReturnType<typeof setTimeout> | undefined
  let resolveGate!: () => void
  let rejectGate!: (reason?: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolveGate = resolve
    rejectGate = reject
  })

  function cleanup(): void {
    updater.removeListener('update-downloaded', onDownloaded)
    updater.removeListener('error', onError)
    if (timeout) clearTimeout(timeout)
    timeout = undefined
  }

  function settle(completion: () => void): void {
    if (settled) return
    settled = true
    cleanup()
    completion()
  }

  function onDownloaded(
    _event: ElectronEvent,
    _releaseNotes: string,
    _releaseName: string,
    _releaseDate: Date,
    updateURL: string
  ): void {
    if (expectedScope === null || nativeStageScope(updateURL) !== expectedScope) return
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
      // Electron's native Squirrel updater to stage the downloaded archive. Its
      // loopback feed uses a fresh non-default port per attempt; claim it once
      // so a late completion from an earlier attempt cannot satisfy this gate.
      // If the pinned dependency contract changes or a port is ever reused,
      // fail closed.
      let scope: string | null
      try {
        scope = nativeStageScope(updater.getFeedURL())
      } catch {
        scope = null
      }
      if (scope !== null && !claimedScopes.has(scope)) {
        expectedScope = scope
        claimedScopes.add(scope)
      }
      updater.on('update-downloaded', onDownloaded)
      if (!ignoreNativeErrors) updater.on('error', onError)
      timeout = setTimeout(
        () => settle(() => rejectGate(NATIVE_STAGE_TIMEOUT)),
        NATIVE_STAGE_TIMEOUT_MS
      )
    },
    shouldDeferLibraryFailure: () => armed && ignoreNativeErrors,
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
  private readonly claimedNativeStageScopes = new Set<string>()
  private hasUnscopedNativeFailureHistory = false
  private autoUpdateEnabled: boolean
  private updateChannel: UpdateChannel
  /** A staged build from another channel must not install on quit. */
  private blockQuitInstall = false
  /**
   * A disallowed download finished after the channel moved on. Quit-install
   * stays off until a new download starts, because the file on disk may be
   * the disallowed build.
   */
  private disallowedDownloadLanded = false
  /** False while a cancelled download can still emit. */
  private acceptDownloadEvents = true
  private downloadingVersion: string | null = null
  private downloadToken: CancellationToken | null = null
  private downloadCompletion: Promise<void> = Promise.resolve()
  private channelChange: Promise<void> = Promise.resolve()

  constructor(private readonly deps: UpdaterServiceDeps) {
    this.state = initialSnapshot(deps.app)
    const settings = deps.getSettings()
    this.autoUpdateEnabled = settings.autoUpdate
    this.updateChannel = normalizeUpdateChannel(settings.updateChannel)
    this.bindAutoUpdater()
    if (this.state.state !== 'unsupported') {
      this.scheduleNextCheck()
    }
  }

  private bindAutoUpdater(): void {
    const { autoUpdater } = this.deps
    autoUpdater.autoDownload = false
    autoUpdater.logger = DISCARDED_UPDATER_LOGGER
    // The stored channel wins over the version electron-updater would infer
    // and over any channel baked into app-update.yml. Set allowDowngrade
    // after channel: assigning channel forces allowDowngrade on.
    this.applyFeed()

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (!this.acceptVersion(info.version)) {
        this.rejectDisallowedUpdate(false)
        return
      }
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
      if (!this.acceptDownloadEvents) return
      this.setState({ progressPercent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      const stale =
        !this.acceptDownloadEvents ||
        (this.downloadingVersion !== null && info.version !== this.downloadingVersion)
      if (stale || !this.acceptVersion(info.version)) {
        this.rejectDownloadedVersion(info)
        return
      }
      if (this.disallowedDownloadLanded) {
        this.keepAllowedOffer(info.version)
        return
      }
      this.blockQuitInstall = false
      this.applyFeed()
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
      // A channel switch cancels the download. electron-updater swallows
      // CancellationError; ignore it here too so it cannot replace the next offer.
      if (
        this.downloadToken?.cancelled &&
        (err instanceof CancellationError || err.message === 'cancelled')
      ) {
        return
      }
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
      this.hasUnscopedNativeFailureHistory = true
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
    // The update is still there to download, so keep offering it (with the
    // failure shown) instead of dropping back to "Check for updates".
    this.setState({
      state: this.state.availableVersion != null ? 'update-available' : 'error',
      failure: 'download-write'
    })
    this.logUpdaterWarning('autoUpdater: download failed')
  }

  /**
   * Point electron-updater at the stored channel. Assign `channel` first:
   * its setter forces `allowDowngrade` on, and stable must turn that back off.
   */
  private applyFeed(): void {
    const feed = updateFeedFor(this.updateChannel)
    this.deps.autoUpdater.channel = feed.channel
    this.deps.autoUpdater.allowPrerelease = feed.allowPrerelease
    this.deps.autoUpdater.allowDowngrade = feed.allowDowngrade
    this.deps.autoUpdater.autoInstallOnAppQuit = !this.blockQuitInstall
  }

  private acceptVersion(version: string): boolean {
    return versionAllowedOnChannel(version, this.updateChannel)
  }

  /**
   * A download finished for a build the current channel does not allow, or
   * for an attempt that was already cancelled. Never publish it, and never
   * let it clear an allowed version that is already on offer.
   */
  private rejectDownloadedVersion(info: UpdateInfo): void {
    this.disallowedDownloadLanded = true
    this.nativeStageGate?.cancel()
    this.downloadInFlight = false
    this.pendingDownloadedInfo = null
    this.blockQuitInstall = true
    this.applyFeed()
    this.checkOrigin = null
    this.logUpdaterWarning('autoUpdater: ignored update outside the selected channel')
    if (this.state.state === 'unsupported') return
    const offered = this.state.availableVersion
    const keepOffer = offered != null && offered !== info.version && this.acceptVersion(offered)
    if (keepOffer) {
      this.keepAllowedOffer(offered)
      return
    }
    this.setState({ state: 'idle', availableVersion: null, progressPercent: 0, failure: null })
  }

  /** Keep offering an allowed version without arming quit-install. */
  private keepAllowedOffer(version: string): void {
    this.blockQuitInstall = true
    this.applyFeed()
    this.nativeStageGate?.cancel()
    this.downloadInFlight = false
    this.pendingDownloadedInfo = null
    this.setState({
      state: 'update-available',
      availableVersion: version,
      progressPercent: 0,
      failure: null
    })
  }

  /**
   * Drop an offer from another channel. Block quit-install only when that
   * build was already downloading or staged — a rejected offer must not
   * disarm an earlier allowed download.
   */
  private rejectDisallowedUpdate(staged: boolean): void {
    if (
      staged ||
      this.state.state === 'downloaded' ||
      this.state.state === 'downloading' ||
      this.downloadInFlight
    ) {
      this.blockQuitInstall = true
      this.applyFeed()
    }
    this.checkOrigin = null
    this.logUpdaterWarning('autoUpdater: ignored update outside the selected channel')
    if (this.state.state === 'unsupported') return
    this.setState({ state: 'idle', availableVersion: null, progressPercent: 0, failure: null })
  }

  private publishDownloaded(info: UpdateInfo): void {
    this.blockQuitInstall = false
    this.applyFeed()
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

    // Follow the saved snapshot, including a channel change that landed
    // before this scheduled or manual check.
    this.updateChannel = normalizeUpdateChannel(this.deps.getSettings().updateChannel)
    this.applyFeed()

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

  /**
   * Called after every settings save. Turning Automatic updates on while an
   * update is already offered starts that download now, instead of at the
   * next scheduled check hours later. Other saves never retry a download.
   */
  applySettings(settings: AutoUpdateSettings): void {
    const turnedOn = settings.autoUpdate && !this.autoUpdateEnabled
    this.autoUpdateEnabled = settings.autoUpdate
    let channelChanged = false
    if ('updateChannel' in settings) {
      const next = normalizeUpdateChannel(settings.updateChannel)
      channelChanged = next !== this.updateChannel
      this.updateChannel = next
      this.applyFeed()
    }
    if (channelChanged) {
      this.enqueueChannelChange()
      return
    }
    if (turnedOn) void this.download()
  }

  /**
   * Channel switches are serialized. Each one settles an in-flight download
   * before checking, so electron-updater's `downloadPromise` cannot be reused
   * for the next channel.
   */
  private enqueueChannelChange(): void {
    const run = this.channelChange.then(() => this.applyChannelChange())
    this.channelChange = run.then(
      () => undefined,
      () => undefined
    )
  }

  private async applyChannelChange(): Promise<void> {
    if (this.disposed) return
    // `downloadInFlight` is cleared as soon as a disallowed file event arrives,
    // while electron-updater may still be holding that download promise.
    const inFlight =
      this.downloadToken != null || this.downloadInFlight || this.state.state === 'downloading'
    if (inFlight) await this.cancelDownload()
    if (this.disposed) return
    if (this.state.availableVersion != null && !this.acceptVersion(this.state.availableVersion)) {
      this.rejectDisallowedUpdate(
        this.state.state === 'downloaded' || this.state.state === 'downloading'
      )
    }
    const blocked = ['unsupported', 'downloading', 'downloaded', 'checking']
    if (!blocked.includes(this.state.state)) await this.check()
  }

  /**
   * Cancel the library download and wait until its promise settles.
   * `downloadUpdate` returns the previous promise while one is stored.
   */
  private async cancelDownload(): Promise<void> {
    this.acceptDownloadEvents = false
    this.blockQuitInstall = true
    this.applyFeed()
    this.downloadToken?.cancel()
    this.nativeStageGate?.cancel()
    await this.downloadCompletion
    if (this.state.state === 'downloading') {
      this.downloadInFlight = false
      this.pendingDownloadedInfo = null
      this.setState({ state: 'idle', availableVersion: null, progressPercent: 0, failure: null })
    }
  }

  async download(): Promise<void> {
    if (!this.deps.app.isPackaged) return
    if (this.state.state !== 'update-available') return
    if (isPortable()) return
    if (this.state.availableVersion != null && !this.acceptVersion(this.state.availableVersion)) {
      this.rejectDisallowedUpdate(false)
      return
    }

    const token = new CancellationToken()
    this.downloadToken = token
    this.acceptDownloadEvents = true
    this.disallowedDownloadLanded = false
    this.downloadingVersion = this.state.availableVersion
    let resolveCompletion: () => void = () => undefined
    this.downloadCompletion = new Promise((resolve) => {
      resolveCompletion = resolve
    })

    this.setState({ state: 'downloading', progressPercent: 0, failure: null })
    this.beginOperationErrorTracking()
    this.downloadInFlight = true
    this.pendingDownloadedInfo = null
    const nativeStageGate = this.deps.nativeStageUpdater
      ? createNativeStageGate(
          this.deps.nativeStageUpdater,
          this.claimedNativeStageScopes,
          this.hasUnscopedNativeFailureHistory
        )
      : null
    this.nativeStageGate = nativeStageGate
    try {
      const downloadPromise = this.deps.autoUpdater.downloadUpdate(token)
      if (nativeStageGate) {
        const libraryCompletion = Promise.resolve(downloadPromise).then(
          (result) => {
            nativeStageGate.releaseIfUnarmed()
            return result
          },
          (error: unknown) => {
            // MacUpdater attaches every in-flight download to Electron's global,
            // unscoped native `error` event. After one staged failure, a late
            // error from that attempt can therefore reject a retry's library
            // promise. Once this retry has armed its uniquely scoped native gate,
            // only matching native success or the local deadline may settle it.
            if (nativeStageGate.shouldDeferLibraryFailure()) return undefined
            throw error
          }
        )
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
      if (token.cancelled || err instanceof CancellationError) return
      if (!this.wasHandledByCurrentEvent(err)) {
        this.handleError()
        this.rememberHandledObject(err)
      }
    } finally {
      resolveCompletion()
      nativeStageGate?.cancel()
      if (this.nativeStageGate === nativeStageGate) this.nativeStageGate = null
      if (this.downloadToken === token) this.downloadToken = null
      this.downloadInFlight = false
      this.pendingDownloadedInfo = null
      this.downloadingVersion = null
      // A cancelled attempt must stay idle for the channel switch that
      // follows, not bounce back to the build that was just rejected.
      if (!token.cancelled && this.snapshot().state === 'downloading') {
        this.setState({ state: 'update-available', progressPercent: 0, failure: null })
      }
    }
  }

  install(): void {
    if (!this.deps.app.isPackaged) return
    if (this.state.state !== 'downloaded') return
    if (this.blockQuitInstall || this.disallowedDownloadLanded) return
    if (this.state.availableVersion != null && !this.acceptVersion(this.state.availableVersion)) {
      this.rejectDisallowedUpdate(true)
      return
    }
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
let updaterServiceLoad: Promise<UpdaterService> | undefined

/**
 * electron-updater and its fs-extra/js-yaml/semver graph cost ~55ms to load,
 * so they load on first use instead of before the window can open. Idempotent:
 * every caller shares one load, and a failed load stays failed for the session,
 * as a failed synchronous init did before.
 */
export function initAutoUpdater(): Promise<UpdaterService> {
  updaterServiceLoad ??= import('electron-updater').then(async ({ default: electronUpdater }) => {
    const [{ GitHubProvider }, { installDevStablePromotion }] = await Promise.all([
      import('electron-updater/out/providers/GitHubProvider.js'),
      import('./devReleaseFeed')
    ])
    installDevStablePromotion(GitHubProvider)
    updaterService = new UpdaterService({
      app,
      autoUpdater: electronUpdater.autoUpdater,
      getSettings: getSettingsSnapshot,
      log,
      browserWindow: BrowserWindow,
      nativeStageUpdater: process.platform === 'darwin' ? nativeAutoUpdater : undefined
    })
    return updaterService
  })
  return updaterServiceLoad
}

export function getUpdaterService(): UpdaterService {
  if (!updaterService) {
    throw new Error('Updater service has not been initialized')
  }
  return updaterService
}

/** Forward a settings save to the updater once it has loaded. */
export function applyUpdaterSettings(settings: AutoUpdateSettings): void {
  updaterService?.applySettings(settings)
}

/** Before the service loads, its state is the one it would start in. */
export function getUpdaterSnapshot(): UpdaterSnapshot {
  return updaterService?.snapshot() ?? initialSnapshot(app)
}
