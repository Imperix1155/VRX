import { app, shell, BrowserWindow, dialog, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import log, { initLogger } from './logger'
import { initAutoUpdater } from './updater'
import { loadSettings } from './services/settings'
import {
  CREDENTIAL_KEYS,
  clearCredential,
  loadCredential,
  saveCredential
} from './services/credentials'
import { WebSocket } from 'ws'
import { VrcAdapter, type VrcCredentialStore } from './services/adapters/VrcAdapter'
import { VRC_USER_AGENT } from './services/adapters/VrcApiClient'
import { registerIpcHandlers } from './ipc'
import { isAllowedUrl } from './ipc/url-allowlist'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedUrl(details.url)) {
      shell.openExternal(details.url).catch((err: unknown) => {
        log.warn('openExternal failed', { message: String(err) })
      })
    } else {
      // Log protocol+host only — the full URL may contain tokens in query params.
      try {
        const u = new URL(details.url)
        log.warn('window-open blocked', { protocol: u.protocol, host: u.hostname })
      } catch {
        log.warn('window-open blocked', { url: '[unparseable]' })
      }
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  // A load failure means a blank window — log it loudly instead of dropping it.
  const loaded =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
      : mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  loaded.catch((err: unknown) => {
    log.error('renderer load failed', { message: String(err) })
  })

  // ── Renderer crash/hang handlers (VRX-127 follow-up) ──────────────────────

  // render-process-gone fires when the renderer process exits unexpectedly.
  // Denylist only intentional teardown reasons — all others (crashed, oom,
  // abnormal-exit, launch-failed, integrity-failure, memory-eviction) surface
  // a recovery dialog. 'clean-exit' is normal shutdown; 'killed' is the
  // reason emitted when forcefullyCrashRenderer() is called to unstick an
  // unresponsive renderer, so a second dialog is never shown for that path.
  const SILENT_REASONS: ReadonlySet<string> = new Set(['clean-exit', 'killed'])

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    // Expected exits (a clean shutdown, or our own forcefullyCrashRenderer →
    // 'killed') are silent — don't error-log or alarm on them (CodeRabbit).
    if (SILENT_REASONS.has(details.reason)) return

    log.error('render-process-gone', { reason: details.reason, exitCode: details.exitCode })

    dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'VRX — Renderer Crashed',
        message: 'The window has stopped responding due to an unexpected error.',
        detail: `Reason: ${details.reason} (exit code ${details.exitCode})`,
        buttons: ['Reload', 'Close'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (!mainWindow.isDestroyed() && response === 0) {
          mainWindow.reload()
        }
      })
      .catch((err: unknown) => {
        log.warn('render-process-gone dialog rejected', { message: String(err) })
      })
  })

  // unresponsive fires when the renderer stops responding to IPC pings.
  mainWindow.on('unresponsive', () => {
    log.warn('window-unresponsive')

    dialog
      .showMessageBox(mainWindow, {
        type: 'warning',
        title: 'VRX — Window Not Responding',
        message: 'VRX is not responding.',
        detail: 'The window may be busy. You can wait or reload it.',
        buttons: ['Reload', 'Wait'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (!mainWindow.isDestroyed() && response === 0) {
          // Force-kill the stuck renderer before reloading so the reload
          // starts a fresh process. This emits render-process-gone with
          // reason 'killed', which is silently skipped by SILENT_REASONS.
          mainWindow.webContents.forcefullyCrashRenderer()
          mainWindow.reload()
        }
      })
      .catch((err: unknown) => {
        log.warn('unresponsive dialog rejected', { message: String(err) })
      })
  })
}

// ── Main-process crash handlers (VRX-127) ─────────────────────────────────────
// Registered at module scope BEFORE app.whenReady() so they are active for the
// earliest boot errors — including a synchronous throw during startup, which
// would otherwise bypass the guarded exit below (CodeRabbit, audit W3).

let crashing = false
process.on('uncaughtException', (error: Error) => {
  // Registering ANY uncaughtException listener suppresses Node's default
  // print-and-exit, so a handler that only logs would leave the app limping on
  // in an undefined state — worse than crashing. Log the fatal error (electron-
  // log's file transport is synchronous, so it flushes to disk before we exit),
  // then terminate. The guard stops a second exception during teardown from
  // re-entering and calling app.exit twice.
  if (crashing) return
  crashing = true
  log.error('uncaughtException — terminating', { message: error.message, stack: error.stack })
  app.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  // Log without exiting — an unhandled rejection alone doesn't warrant a crash.
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  log.warn('unhandledRejection', { message, stack })
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app
  .whenReady()
  .then(() => {
    // Structured logging first, so anything below is captured (VRX-15).
    initLogger()

    // Lock down the default session's permission surface (defense-in-depth). VRX
    // loads only its own bundled renderer and legitimately needs exactly one web
    // permission: writing to the clipboard (ErrorBoundary's "copy details" button,
    // which requests `clipboard-sanitized-write`). Deny every other request/check —
    // camera, microphone, geolocation, notifications, MIDI, HID, … — so a
    // compromised renderer can't reach for device APIs.
    const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission))
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      ALLOWED_PERMISSIONS.has(permission)
    )

    // Load persisted settings (migrate + validate on read; normalizes the on-disk
    // file to the current schema). Available for IPC/store wiring next (VRX-23).
    const settings = loadSettings()
    log.info('settings loaded', { version: settings.version, theme: settings.theme })

    // Set app user model id for windows — must match electron-builder `appId`
    // so Windows groups the taskbar entry and update notifications fire.
    electronApp.setAppUserModelId('com.imperix.vrx')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // The VRChat session cookie persists via safeStorage (VRX-34); the store is
    // injected so VrcAdapter stays electron-free + unit-testable (VRX-157).
    const vrcCredentials: VrcCredentialStore = {
      load: () => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY),
      save: (cookie) => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, cookie),
      delete: () => clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)
    }
    // Live-pipeline wiring (VRX-146): the real socket carries the required
    // User-Agent (same policy as REST — VRX-129); logs route through the
    // redaction hook. The adapter itself stays electron-free.
    const vrcAdapter = new VrcAdapter(vrcCredentials, undefined, {
      socketFactory: (url) => new WebSocket(url, { headers: { 'User-Agent': VRC_USER_AGENT } }),
      log: (level, message, meta) => log[level](message, meta)
    })
    const adapters = new Map([['vrchat' as const, vrcAdapter]])
    registerIpcHandlers(adapters)

    // Broadcast live adapter events to every window over the typed push
    // channel ('friend-event', @shared/ipc). The renderer applies them to the
    // TanStack cache — presence is PUSHED, never polled (CLAUDE.md).
    const unsubscribeLive = vrcAdapter.subscribe((event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        // Guard a window torn down between enumeration and send.
        if (!window.isDestroyed()) window.webContents.send('friend-event', event)
      }
    })
    app.on('before-quit', () => {
      // Close the socket and halt the reconnect loop so quit is clean.
      unsubscribeLive()
    })

    createWindow()

    // Check GitHub Releases for updates on startup (packaged builds only).
    // Own try/catch: a sync throw here would otherwise reach the bootstrap
    // .catch and exit an app whose window ALREADY WORKS — auto-update failure
    // is never worth killing a healthy session (audit W7 review).
    try {
      initAutoUpdater()
    } catch (error) {
      log.warn('autoUpdater init failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    // A bootstrap failure (settings load, IPC registration, window creation)
    // would otherwise surface only as a logged unhandledRejection and leave the
    // app running with NO window. Same policy as uncaughtException: log + exit.
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    log.error('bootstrap failed — terminating', { message, stack })
    app.exit(1)
  })

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
