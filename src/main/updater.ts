/**
 * Consent-based auto-update service (VRX-113).
 *
 * Reworks the previous silent auto-update flow into an explicit state machine:
 * - Never download or install without user consent.
 * - Packaged builds only; dev and portable NSIS builds are unsupported.
 * - Jittered periodic re-check (~4 h + up to 30 min) via a setTimeout chain.
 * - State transitions broadcast to every renderer window on `updater:state-changed`.
 */
import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import log from './logger'
import { getSettingsSnapshot } from './services/settings'

export type UpdaterState =
  'idle' | 'checking' | 'update-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'

export interface UpdaterSnapshot {
  state: UpdaterState
  currentVersion: string
  availableVersion: string | null
  progressPercent: number
  errorMessage: string | null
}

interface UpdaterLogger {
  warn(message: string, ...meta: unknown[]): void
}

interface AutoUpdateSettings {
  autoUpdate: boolean
}

export interface UpdaterServiceDeps {
  app: typeof app
  autoUpdater: AppUpdater
  getSettings: () => AutoUpdateSettings
  log: UpdaterLogger
  browserWindow: typeof BrowserWindow
}

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
export const MAX_JITTER_MS = 30 * 60 * 1000 // 0–30 minutes

function isPortable(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_DIR
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Strip absolute filesystem paths from user-facing error messages (R9).
 * Windows (`C:\Users\name\...`) and Unix (`/home/name/...`) paths are replaced
 * by their basename; the raw message still goes through the redacted log.
 */
export function sanitizeErrorForDisplay(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s'"]+/g, (match) => {
      const parts = match.split(/[\\/]/)
      return parts[parts.length - 1] ?? '…'
    })
    .replace(/(?:^|[\s'"(])\/[^\s'"]+/g, (match) => {
      const leading = match.charAt(0)
      if (leading === '/') {
        const parts = match.split('/').filter(Boolean)
        return parts[parts.length - 1] ?? '…'
      }
      const path = match.slice(1)
      const parts = path.split('/').filter(Boolean)
      const base = parts[parts.length - 1] ?? '…'
      return `${leading}${base}`
    })
}

export class UpdaterService {
  private state: UpdaterSnapshot
  private checkTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  private checkOrigin: UpdaterState | null = null

  constructor(private readonly deps: UpdaterServiceDeps) {
    this.state = {
      state: isPortable() ? 'unsupported' : 'idle',
      currentVersion: deps.app.getVersion(),
      availableVersion: null,
      progressPercent: 0,
      errorMessage: null
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
    autoUpdater.logger = this.deps.log as unknown as NonNullable<AppUpdater['logger']>
    // The release pipeline deliberately publishes every pre-1.0 release as a GitHub
    // PRERELEASE (release.yml). electron-updater's allowPrerelease defaults to false
    // for a stable version string like "0.1.1", which filters ALL of our releases out
    // of the update feed — auto-update would never find anything. Allow prereleases
    // until 1.0; when releases stop being marked prerelease, this line can go.
    autoUpdater.allowPrerelease = true

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({ state: 'update-available', availableVersion: info.version })
      this.checkOrigin = null
      if (this.deps.getSettings().autoUpdate) {
        void this.download()
      }
    })

    autoUpdater.on('update-not-available', () => {
      this.setState({ state: 'idle', availableVersion: null })
      this.checkOrigin = null
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setState({ progressPercent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState({ state: 'downloaded', availableVersion: info.version, progressPercent: 100 })
    })

    autoUpdater.on('error', (err: Error) => {
      this.handleError(formatError(err))
    })
  }

  private handleError(rawMessage: string): void {
    const message = sanitizeErrorForDisplay(rawMessage)
    if (this.state.state === 'downloaded') {
      // Staged install failed: return to update-available so the user can retry.
      this.setState({
        state: 'update-available',
        errorMessage: message
      })
      this.deps.log.warn('autoUpdater: staged install failed, retryable', rawMessage)
      return
    }
    if (this.checkOrigin === 'update-available') {
      // Re-check failed transiently: keep the existing update visible.
      this.setState({ state: 'update-available', errorMessage: message })
      this.checkOrigin = null
      this.deps.log.warn('autoUpdater: re-check failed, preserving update-available', rawMessage)
      return
    }
    this.setState({ state: 'error', errorMessage: message })
    this.deps.log.warn('autoUpdater: error', rawMessage)
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
      a.errorMessage === b.errorMessage
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
    this.setState({ state: 'checking', errorMessage: null })
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
      this.handleError(formatError(err))
    } finally {
      this.checkOrigin = null
    }
  }

  async download(): Promise<void> {
    if (!this.deps.app.isPackaged) return
    if (this.state.state !== 'update-available') return
    if (isPortable()) return

    this.setState({ state: 'downloading', progressPercent: 0 })
    try {
      await this.deps.autoUpdater.downloadUpdate()
      // 'update-downloaded' event drives the final state. If it resolved without
      // firing the event (some test doubles), fall back so the machine doesn't stall.
      if (this.snapshot().state === 'downloading') {
        this.setState({ state: 'update-available', progressPercent: 0 })
      }
    } catch (err) {
      const rawMessage = formatError(err)
      this.setState({ state: 'error', errorMessage: sanitizeErrorForDisplay(rawMessage) })
      this.deps.log.warn('autoUpdater: download failed', rawMessage)
    }
  }

  install(): void {
    if (!this.deps.app.isPackaged) return
    if (this.state.state !== 'downloaded') return
    this.deps.autoUpdater.quitAndInstall()
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
      browserWindow: BrowserWindow
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
