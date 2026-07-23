import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  Notification as NativeNotification,
  type IpcMainEvent
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import log, { initLogger } from './logger'
import { initAutoUpdater } from './updater'
import { getSettingsSnapshot, loadSettings } from './services/settings'
import {
  CREDENTIAL_KEYS,
  clearCredential,
  loadCredential,
  recordCredentialOwner,
  saveCredential
} from './services/credentials'
import { WebSocket } from 'ws'
import { VrcAdapter, type VrcCredentialStore } from './services/adapters/VrcAdapter'
import { VRC_USER_AGENT } from './services/adapters/VrcApiClient'
import { CvrAdapter, type CvrCredentialStore } from './services/adapters/CvrAdapter'
import type { CVRCredentials } from './services/adapters/CvrApiClient'
import type { IPlatformAdapter } from './services/adapters/IPlatformAdapter'
import type { AdapterEvent, Platform } from '@shared/types'
import type { IpcNotifications } from '@shared/ipc'
import { API_TIMEOUT_MS } from '@shared/constants'
import { registerIpcHandlers } from './ipc'
import { avatarCache } from './services/avatarCache'
import { isAllowedUrl } from './ipc/url-allowlist'
import { createTray } from './tray'
import { FriendAlerts, type FriendAlert, type FriendAlertType } from './services/friendAlerts'
import { PendingNavigation } from './pendingNavigation'
import { LocationAuthority } from './services/locationAuthority'
import { AccountSession } from './services/accountSession'
import { AccountRegistry } from './services/accountRegistry'
import { SocialStore } from './services/socialStore'
import { isTrustedIpcSender } from './ipc/security'
import { createShowGate } from './showGate'

// Set true by the before-quit handler below — the single source of truth for
// every quit path (tray Quit, Cmd+Q, dock, app menu). before-quit always fires
// before a window's own 'close' event, so the close handler below always reads
// the up-to-date value (VRX-112). EXCEPTION (advisor F1): autoUpdater's
// quitAndInstall() reverses that order — if a "restart to update" path is ever
// added, set `quitting = true` BEFORE calling it or close-to-tray will swallow
// the close and stall the install in the tray.
let quitting = false

// Module-scope Tray retention (see whenReady) — if the Tray object is GC'd the
// icon silently vanishes. `currentWindow` is the click-time resolution target
// for tray actions: macOS destroys the window on close and `activate` replaces
// it, so the tray must never capture a window instance (Codex, PR #118).
let trayHandle: import('./tray').TrayHandle | null = null
let currentWindow: import('electron').BrowserWindow | null = null
const rendererReadyWindows = new WeakSet<BrowserWindow>()
const dashboardNavigation = new PendingNavigation<BrowserWindow>((window) => {
  if (!window.isDestroyed()) window.webContents.send('navigate-to-dashboard')
})
const retainedFriendNotifications = new Map<NativeNotification, ReturnType<typeof setTimeout>>()
const MAX_RETAINED_FRIEND_NOTIFICATIONS = 20
const FRIEND_NOTIFICATION_RETENTION_MS = 60_000
const RENDERER_HYDRATED_CHANNEL = 'renderer-hydrated' satisfies keyof IpcNotifications
// Trailing creator-set instance label, e.g. "Bono's Movie Night (#teehee)" —
// matches the renderer's display strip (utils/worldName).
const INSTANCE_LABEL_SUFFIX = /\s*\(#[^)]*\)\s*$/

function releaseRetainedFriendNotification(notification: NativeNotification): void {
  const timer = retainedFriendNotifications.get(notification)
  if (timer !== undefined) clearTimeout(timer)
  retainedFriendNotifications.delete(notification)
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    // Window/taskbar name. Without this the title bar reads the renderer's
    // <title> — which is "VRX", but only after the page loads; set it here so
    // the window says VRX from creation, not "Electron" for the first frame.
    title: 'VRX',
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

  const showGate = createShowGate({
    timeoutMs: 3_000,
    onShow: () => {
      if (!mainWindow.isDestroyed()) mainWindow.show()
    },
    onTimeout: () => {
      log.warn('renderer hydration timed out; showing window with fallback')
    }
  })
  mainWindow.once('ready-to-show', () => showGate.ready())

  const onRendererHydrated = (event: IpcMainEvent): void => {
    if (!isTrustedIpcSender(event.senderFrame)) return
    if (event.sender === mainWindow.webContents) showGate.hydrated()
  }
  ipcMain.on(RENDERER_HYDRATED_CHANNEL, onRendererHydrated)
  mainWindow.once('closed', () => {
    ipcMain.removeListener(RENDERER_HYDRATED_CHANNEL, onRendererHydrated)
    showGate.dispose()
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

  const rendererPath = join(__dirname, '../renderer/index.html')
  const hasDevServer = is.dev && Boolean(process.env['ELECTRON_RENDERER_URL'])
  const rendererEntry =
    hasDevServer && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(rendererPath).href
  const entryUrl = new URL(rendererEntry)
  const entryOrigin = entryUrl.origin
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    try {
      const url = new URL(event.url)
      const isOwnEntry =
        entryUrl.protocol === 'file:' ? url.href === entryUrl.href : url.origin === entryOrigin
      if (!isOwnEntry) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })

  // A notification click can recreate a window whose renderer has not mounted
  // its push listener yet. Keep one pending dashboard intent until this load is
  // complete, then replay it exactly once. A reload clears readiness first.
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReadyWindows.delete(mainWindow)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReadyWindows.add(mainWindow)
    if (currentWindow === mainWindow) dashboardNavigation.rendererReady(mainWindow)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  // A load failure means a blank window — log it loudly instead of dropping it.
  const loaded = hasDevServer
    ? mainWindow.loadURL(rendererEntry)
    : mainWindow.loadFile(rendererPath)
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

  // Close-to-tray (VRX-112): on Windows/Linux the close button hides the
  // window instead of quitting — the app keeps running in the tray. macOS
  // keeps its default close behavior (the app itself stays open via
  // window-all-closed below; the tray is just an extra affordance there).
  mainWindow.on('close', (event) => {
    if (!quitting && process.platform !== 'darwin') {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  return mainWindow
}

/** Resolve the current main window at activation time, recreating and rewiring
 *  it through the same VRX-112 lifecycle when every prior window was destroyed. */
function getOrCreateMainWindow(): BrowserWindow {
  if (currentWindow !== null && !currentWindow.isDestroyed()) return currentWindow

  const existing = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (existing !== undefined) {
    currentWindow = existing
    return existing
  }

  currentWindow = createWindow()
  trayHandle?.wireWindow(currentWindow)
  return currentWindow
}

function focusMainWindow(): BrowserWindow {
  const window = getOrCreateMainWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

function focusDashboard(): void {
  const window = focusMainWindow()
  dashboardNavigation.request(window, rendererReadyWindows.has(window))
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
    // file to the current schema). The renderer fetches them over 'get-settings'
    // once it boots (VRX-184); this early load tidies the file and logs the state.
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
      save: (cookie, accountId) => {
        saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, cookie)
        if (accountId !== null) {
          recordCredentialOwner(CREDENTIAL_KEYS.VRCHAT_PRIMARY, accountId)
        }
      },
      delete: () => clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)
    }
    // Live-pipeline wiring (VRX-146): the real socket carries the required
    // User-Agent (same policy as REST — VRX-129); logs route through the
    // redaction hook. The adapter itself stays electron-free.
    const friendAlertBoundary: { current?: FriendAlerts } = {}
    const accountSession = new AccountSession()
    const accountRegistry = new AccountRegistry(accountSession)
    const socialStore = new SocialStore(accountSession)
    const locationAuthority = new LocationAuthority({
      clock: () => performance.now(),
      log: (level, message, meta) => log[level](message, meta)
    })
    const vrcAdapter = new VrcAdapter(vrcCredentials, undefined, {
      // handshakeTimeout bounds a black-holed connect so the reconnect backoff
      // can retry instead of waiting for the OS default (~1-2 min).
      socketFactory: (url) =>
        new WebSocket(url, {
          headers: { 'User-Agent': VRC_USER_AGENT },
          handshakeTimeout: API_TIMEOUT_MS
        }),
      log: (level, message, meta) => log[level](message, meta),
      onIdentity: (accountId) => {
        accountSession.setIdentity('vrchat', accountId)
      },
      onSessionBoundary: () => {
        friendAlertBoundary.current?.resetPlatform('vrchat')
        locationAuthority.clearPlatform('vrchat')
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send('identity-boundary', { platform: 'vrchat' })
          }
        }
        // VRX-202: auth changed — cached avatar FAILURES (401s from the old
        // auth state) are stale; successes are auth-invariant and stay.
        avatarCache.clearNegativeEntries()
      }
    })
    // CVR session = { username, accessKey } persisted as ONE safeStorage blob
    // (VRX-37/174). The parse guard means a corrupted blob reads as "no session"
    // instead of crashing the adapter constructor at boot.
    const cvrCredentials: CvrCredentialStore = {
      load: (): CVRCredentials | undefined => {
        const raw = loadCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY)
        if (!raw) return undefined
        try {
          const parsed: unknown = JSON.parse(raw)
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            typeof (parsed as CVRCredentials).username === 'string' &&
            typeof (parsed as CVRCredentials).accessKey === 'string'
          ) {
            return parsed as CVRCredentials
          }
        } catch {
          /* fall through — malformed blob */
        }
        return undefined
      },
      save: (credentials, accountId) => {
        saveCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, JSON.stringify(credentials))
        if (accountId !== null) {
          recordCredentialOwner(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, accountId)
        }
      },
      delete: () => clearCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY)
    }
    // CVR live pipeline (VRX-58): credentials ride in the upgrade HEADERS
    // (Username/AccessKey/User-Agent/Platform — same as REST, VRX-129), so the
    // socketFactory forwards them verbatim; logs route through the redaction hook.
    const cvrAdapter = new CvrAdapter(cvrCredentials, undefined, {
      // Same black-hole guard as the VRChat pipeline (audit OP-A4).
      socketFactory: (url, headers) =>
        new WebSocket(url, { headers, handshakeTimeout: API_TIMEOUT_MS }),
      log: (level, message, meta) => log[level](message, meta),
      onIdentity: (accountId) => {
        accountSession.setIdentity('chilloutvr', accountId)
      },
      onSessionBoundary: () => {
        friendAlertBoundary.current?.resetPlatform('chilloutvr')
        locationAuthority.clearPlatform('chilloutvr')
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send('identity-boundary', { platform: 'chilloutvr' })
          }
        }
      }
    })

    const adapters = new Map<Platform, IPlatformAdapter>([
      ['vrchat', vrcAdapter],
      ['chilloutvr', cvrAdapter]
    ])

    const showFriendAlert = (alert: FriendAlert): void => {
      if (!NativeNotification.isSupported()) return

      // Copy shape (VRX-204, owner feedback on live toasts): Title Case headers
      // ("headers generally have all of the words capitalized"), header = the
      // general event category, body = the specifics. Exact wording is
      // owner-adjustable — flagged in the PR; strings stay main-side pending
      // the parked notification-i18n follow-up.
      let title: string
      let body: string
      switch (alert.type) {
        case 'online':
          title = 'Friend Online'
          body = `${alert.displayName} came online`
          break
        case 'in-game': {
          title = 'Friend Joined a World'
          // Match the renderer's trailing instance-label cleanup. Notifications
          // are deliberately one-shot: later true-world enrichment corrects the
          // baseline but does not attempt to replace an already delivered toast.
          const strippedWorldName = alert.worldName?.replace(INSTANCE_LABEL_SUFFIX, '').trim() ?? ''
          const worldName = strippedWorldName === '' ? null : strippedWorldName
          body =
            worldName === null
              ? `${alert.displayName} joined a world`
              : `${alert.displayName} joined ${worldName}`
          break
        }
        case 'offline':
          title = 'Friend Offline'
          body = `${alert.displayName} went offline`
          break
        case 'hot-instance': {
          title = 'Friends Gathering'
          const strippedWorldName = alert.worldName?.replace(INSTANCE_LABEL_SUFFIX, '').trim() ?? ''
          body =
            strippedWorldName === ''
              ? `${alert.friendCount} friends are in the same world — join them?`
              : `${alert.friendCount} friends are in ${strippedWorldName} — join them?`
          break
        }
      }

      try {
        // VRX-82: native toasts carry the packaged app icon.
        const notification = new NativeNotification({ title, body, icon })
        notification.on('click', alert.type === 'hot-instance' ? focusDashboard : focusMainWindow)
        const cleanup = (): void => releaseRetainedFriendNotification(notification)
        notification.once('close', cleanup)
        notification.once('failed', () => {
          // Never log native error text: platform messages can echo body copy,
          // which contains a friend's display name.
          log.warn('friend notification failed')
          cleanup()
        })
        const cleanupTimer = setTimeout(cleanup, FRIEND_NOTIFICATION_RETENTION_MS)
        cleanupTimer.unref()
        retainedFriendNotifications.set(notification, cleanupTimer)
        if (retainedFriendNotifications.size > MAX_RETAINED_FRIEND_NOTIFICATIONS) {
          const oldest = retainedFriendNotifications.keys().next().value
          if (oldest !== undefined) releaseRetainedFriendNotification(oldest)
        }
        try {
          notification.show()
        } catch (error) {
          cleanup()
          throw error
        }
      } catch {
        // Native notification failure must never interrupt the shared adapter
        // subscription path. Do not log the alert/error contents: both may
        // contain a friend's display name.
        log.warn('friend notification failed')
      }
    }

    const alertSettingEnabled = (type: FriendAlertType): boolean => {
      // The settings service updates this in-memory snapshot synchronously on
      // save, so fire-time decisions stay current without store I/O in the WS path.
      const current = getSettingsSnapshot()
      switch (type) {
        case 'online':
          return current.notifyFriendOnline
        case 'in-game':
          return current.notifyFriendInGame
        case 'offline':
          return current.notifyFriendOffline
        case 'hot-instance':
          return current.notifyHotInstance
      }
    }

    const friendAlerts = new FriendAlerts({
      notify: showFriendAlert,
      // Monotonic time keeps limiter windows correct across wall-clock adjustments.
      clock: () => performance.now(),
      isEnabled: alertSettingEnabled,
      hotInstanceThreshold: () => getSettingsSnapshot().hotInstanceThreshold,
      resolveName: (platform, platformUserId) =>
        platform === 'chilloutvr' ? cvrAdapter.resolveFriendName(platformUserId) : null
    })
    friendAlertBoundary.current = friendAlerts

    // VRX-202: the avatar fetcher needs the live VRChat auth cookie (the image
    // endpoint 401s unauthenticated). Late-wired so logout/rotation apply on read.
    avatarCache.setVrcCookieProvider(() => vrcAdapter.getAuthCookieHeader())

    registerIpcHandlers(adapters, {
      accountRegistry,
      accountSession,
      socialStore,
      onAuthStatus: (status) => {
        if (
          status.state === 'authenticated' &&
          status.accountId !== null &&
          status.displayName !== null
        ) {
          const resolution = accountSession.resolve(status.platform)
          if ('status' in resolution) return
          accountRegistry.recordAuthenticated(
            status.platform,
            status.accountId,
            resolution.epoch,
            status.displayName
          )
        }
      },
      locationAuthority,
      instance: {
        clock: () => performance.now(),
        log: (_level, message, meta) => log.warn(message, meta)
      }
    })

    // Broadcast live adapter events to every window over the typed push
    // channel ('friend-event', @shared/ipc). The renderer applies them to the
    // TanStack cache — presence is PUSHED, never polled (CLAUDE.md). Both
    // platforms share one broadcaster; the renderer keys events by platform.
    const broadcast = (event: AdapterEvent): void => {
      for (const window of BrowserWindow.getAllWindows()) {
        // Guard a window torn down between enumeration and send.
        if (!window.isDestroyed()) window.webContents.send('friend-event', event)
      }
    }
    const handleAdapterEvent = (event: AdapterEvent): void => {
      locationAuthority.consume(event)
      friendAlerts.consume(event)
      broadcast(event)
    }
    const unsubscribeVrcLive = vrcAdapter.subscribe(handleAdapterEvent)
    const unsubscribeCvrLive = cvrAdapter.subscribe(handleAdapterEvent)
    app.on('before-quit', () => {
      // Close both sockets and halt the reconnect loops so quit is clean.
      unsubscribeVrcLive()
      unsubscribeCvrLive()
      // Single source of truth for every quit path (tray Quit, Cmd+Q, dock,
      // app menu) — before-quit always fires before a window's own 'close'
      // event, so the close-to-tray handler in createWindow() always sees the
      // up-to-date value (VRX-112; sole exception: quitAndInstall — see the
      // `quitting` declaration).
      quitting = true
    })

    currentWindow = createWindow()
    trayHandle = createTray(() => currentWindow)
    trayHandle.wireWindow(currentWindow)
    if (process.platform === 'win32') {
      // Windows can activate a toast after its instance object was collected or
      // after a cold start; the central handler complements the instance click.
      NativeNotification.handleActivation(focusMainWindow)
    }

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
      // dock icon is clicked and there are no other windows open. The tray
      // resolves windows at click time, so updating `currentWindow` + rewiring
      // the menu listeners is all the rebinding it needs (Codex, PR #118).
      if (BrowserWindow.getAllWindows().length === 0) {
        currentWindow = createWindow()
        trayHandle?.wireWindow(currentWindow)
      }
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
