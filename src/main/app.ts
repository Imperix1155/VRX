import { createRendererRecovery } from './services/rendererRecovery'
import { ApiAdmissionController } from './services/adapters/ApiAdmissionController'
import { ExploreService } from './services/exploreService'
import { AvatarLibraryService } from './services/avatarLibraryService'
import { CurrentAvatarService } from './services/currentAvatarService'
import { CommunityService } from './services/communityService'
import type { CommunityAdapter } from './services/adapters/CommunityAdapter'
import { JoinCoordinator } from './services/joinCoordinator'
import { GameHandoff, RunningGames, processNameListerFor } from './services/gameHandoff'
import type { ExploreAdapter } from './services/adapters/ExploreAdapter'
import type { AvatarLibraryAdapter } from './services/adapters/AvatarLibraryAdapter'
import {
  app,
  shell,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  session,
  Notification as NativeNotification,
  type IpcMainEvent,
  type WebContents
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import log, { initLogger } from './logger'
import { applyUpdaterSettings, initAutoUpdater, STARTUP_CHECK_DELAY_MS } from './updater'
import { flushPendingSettingsSave, getSettingsSnapshot, loadSettings } from './services/settings'
import {
  CREDENTIAL_KEYS,
  clearCredential,
  loadCredential,
  removeLegacyCredentialOwnerStore,
  saveCredential,
  signOutCredential
} from './services/credentials'
import { VrcAdapter, type VrcCredentialStore } from './services/adapters/VrcAdapter'
import { CvrAdapter, type CvrCredentialStore } from './services/adapters/CvrAdapter'
import type { CVRCredentials } from './services/adapters/CvrApiClient'
import type { IPlatformAdapter } from './services/adapters/IPlatformAdapter'
import type { BroadcastAdapterEvent } from '@shared/ipc'
import type { Platform } from '@shared/types'
import { ACTIVITY_PUSH_COALESCE_MS } from '@shared/constants'
import { registerIpcHandlers } from './ipc'
import { applyWindowTheme, watchSystemTheme, windowBackgroundColor } from './windowTheme'
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BODY_BYTES,
  avatarCache
} from './services/avatarCache'
import { IMAGE_DISK_DIRECTORY, ImageDiskStore } from './services/imageDiskStore'
import { createAvatarRenditionMaker } from './services/avatarRendition'
import { APP_BACKGROUND_DIRECTORY, AppBackgroundStore } from './services/appBackground'
import { VRC_METADATA_DIRECTORY, VrcMetadataStore } from './services/vrcMetadataStore'
import { isAllowedUrl } from './ipc/url-allowlist'
import { installNavigationGuards } from './navigationGuards'
import { createTray } from './tray'
import { isQuitShortcut } from './quitShortcut'
import { keepMinimumSizeOnScreen } from './windowMinimumSize'
import { FriendAlerts } from './services/friendAlerts'
import { ActivityFeed } from './services/activityFeed'
import { InboxService } from './services/inbox'
import { PendingNavigation } from './pendingNavigation'
import { LocationAuthority } from './services/locationAuthority'
import { AccountSession } from './services/accountSession'
import { AccountRegistry } from './services/accountRegistry'
import { SocialStore } from './services/socialStore'
import { FriendAlertPicks } from './services/friendAlertPicks'
import { LinkGraphStore } from './services/linkGraphStore'
import { isTrustedIpcSender } from './ipc/security'
import { createShowGate, type ShowGate } from './showGate'
import { AppStatusService } from './services/appStatus'
import { createCvrSocket, createVrcSocket } from './socketFactory'
import {
  createFriendNotificationNotifier,
  type NativeAlert,
  isFriendAlertEnabled,
  isFriendAlertIncluded,
  isInboxAlertEnabled
} from './friendNotifications'
import { createVrOverlayAlerts } from './vrOverlayAlerts'
import { wireAdapterEvents } from './adapterWiring'
import { reconnectLiveOnWake } from './wakeReconnect'
import { importCvrSession } from './services/cvrSessionImport'
import { importVrcxSession } from './services/vrcxSessionImport'
import { createSessionImporter } from './services/sessionImport'
import { mt, setMainLocale } from './i18n'
import { showFatalErrorBox } from './fatalErrorBox'

// Set true by the before-quit handler below — the single source of truth for
// every quit path (tray Quit, Cmd+Q, dock, app menu). before-quit always fires
// before a window's own 'close' event, so the close handler below always reads
// the up-to-date value (VRX-112). autoUpdater's quitAndInstall() ultimately
// routes through app.quit(), so `before-quit` runs normally and latches the
// flag correctly. Pre-latching it on the renderer install click is wrong: if
// the install fails (e.g. signed-app path check fails), the user can no longer
// close the window to tray for the rest of the session.
let quitting = false

// Module-scope Tray retention (see whenReady) — if the Tray object is GC'd the
// icon silently vanishes. `currentWindow` is the click-time resolution target
// for tray actions: macOS destroys the window on close and `activate` replaces
// it, so the tray must never capture a window instance (Codex, PR #118).
let trayHandle: import('./tray').TrayHandle | null = null
let currentWindow: import('electron').BrowserWindow | null = null
let exploreWindowService: ExploreService | undefined
let bootstrapReadyForFocus = false
let secondInstanceFocusPending = false
const rendererReadyWindows = new WeakSet<BrowserWindow>()
let hotNavigationPlatform: Platform = 'vrchat'
const dashboardNavigation = new PendingNavigation<BrowserWindow>((window) => {
  if (!window.isDestroyed()) {
    window.webContents.send('navigate-to-dashboard', { platform: hotNavigationPlatform })
  }
})
const rendererHydrationGates = new WeakMap<WebContents, ShowGate>()

const onRendererHydrated = (event: IpcMainEvent): void => {
  if (!isTrustedIpcSender(event.senderFrame)) return
  rendererHydrationGates.get(event.sender)?.hydrated()
}

function createWindow(): BrowserWindow {
  // VRX-243 / DESIGN.md §8 no-scroll rule: control surfaces (Settings) must
  // never scroll, and nothing enforced a floor — pin it to the shipped
  // default size rather than a new, unmeasured number (see commit body for
  // the row-by-row arithmetic behind this choice). Clamped to the display's
  // work area (review F2): Electron does not clamp min sizes itself, and an
  // unclamped 670 floor would leave small/DPI-scaled displays (e.g. 1366x768
  // at 125%) with the window bottom permanently off-screen and no recovery.
  // keepMinimumSizeOnScreen re-applies the clamp for whichever display the
  // window is on later.
  const { workAreaSize } = screen.getPrimaryDisplay()
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: Math.min(900, workAreaSize.width),
    minHeight: Math.min(670, workAreaSize.height),
    // 900x670 is the page's own size, as the design is measured: without this
    // the title bar and frame came out of it (about 884x631 on Windows), so
    // Settings and sign-in scrolled at the default size. The minimum above
    // applies to the page too.
    useContentSize: true,
    show: false,
    // Window/taskbar name. Without this the title bar reads the renderer's
    // <title> — which is "VRX", but only after the page loads; set it here so
    // the window says VRX from creation, not "Electron" for the first frame.
    title: 'VRX',
    // The app canvas color, painted before the page and on resize, so the
    // window never flashes white (DESIGN.md §2).
    backgroundColor: windowBackgroundColor(),
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
  rendererHydrationGates.set(mainWindow.webContents, showGate)
  mainWindow.once('ready-to-show', () => showGate.ready())
  mainWindow.on('hide', () => exploreWindowService?.setActive([]))
  mainWindow.on('minimize', () => exploreWindowService?.setActive([]))
  mainWindow.once('closed', () => {
    exploreWindowService?.setActive([])
    showGate.dispose()
  })

  const rendererPath = join(__dirname, '../renderer/index.html')
  const hasDevServer = is.dev && Boolean(process.env['ELECTRON_RENDERER_URL'])
  const rendererEntry =
    hasDevServer && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(rendererPath).href
  installNavigationGuards({
    webContents: mainWindow.webContents,
    rendererEntry,
    isAllowedUrl,
    openExternal: (url) => shell.openExternal(url),
    warn: (message, metadata) => log.warn(message, metadata)
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

  const recovery = createRendererRecovery({
    window: mainWindow,
    showDialog: (options) => dialog.showMessageBox(mainWindow, options),
    onError: (error) => log.warn('renderer recovery dialog rejected', { message: String(error) }),
    isQuitting: () => quitting
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    exploreWindowService?.setActive([])
    if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
      log.error('render-process-gone', { reason: details.reason, exitCode: details.exitCode })
    }
    recovery.crashed(details.reason, details.exitCode)
  })
  mainWindow.on('unresponsive', () => {
    log.warn('window-unresponsive')
    recovery.unresponsive()
  })

  keepMinimumSizeOnScreen(mainWindow)

  // The default app menu is removed on Windows/Linux, so restore its Ctrl+Q.
  if (process.platform !== 'darwin') {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (!isQuitShortcut(input)) return
      event.preventDefault()
      app.quit()
    })
  }

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

function focusDashboard(platform: Platform): void {
  hotNavigationPlatform = platform
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
  showFatalErrorBox('runtime')
  app.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  // Log without exiting — an unhandled rejection alone doesn't warrant a crash.
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  log.warn('unhandledRejection', { message, stack })
})

// ── Single-instance lock, surviving-instance half (VRX-230) ───────────────────
// The lock itself is acquired in the entry module (index.ts) BEFORE this chunk
// loads — the entry/app split keeps a lock-losing duplicate from ever loading
// any of this file's imports (no logger, no keychain reads, no sockets). This
// chunk only ever runs in the instance holding the lock.
app.on('second-instance', () => {
  // Fires when a duplicate launch was refused: foreground the existing window
  // (restore if minimized, show if hidden to tray — the VRX-185 stranded-
  // window recovery path — then focus). During early boot there is no window
  // yet and BrowserWindow creation before whenReady throws; the bootstrap is
  // about to show one anyway, so skip. The duplicate's argv/cwd are
  // deliberately ignored — VRX registers no protocol/deep-link handler; route
  // them here if one is ever added.
  if (!app.isReady()) return
  if (!bootstrapReadyForFocus) {
    secondInstanceFocusPending = true
    return
  }
  focusMainWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app
  .whenReady()
  .then(() => {
    // Structured logging first, so anything below is captured (VRX-15).
    initLogger()
    // Same source as the renderer's navigator.language, so dialogs, tray and
    // notifications match the window's language.
    setMainLocale(app.getLocale())

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
    // Native chrome (title bar, menus, window background) follows the Theme
    // setting, including OS switches while it is System.
    applyWindowTheme(settings.theme)
    watchSystemTheme()

    // Set app user model id for windows — must match electron-builder `appId`
    // so Windows groups the taskbar entry and update notifications fire.
    electronApp.setAppUserModelId('com.imperix.vrx')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })
    // Without an app menu Electron installs its default one. The window hides it
    // (autoHideMenuBar), but Alt still revealed File/Edit/View/Window/Help with
    // Reload and Toggle Developer Tools, which the shortcut guard above can't
    // block. Windows/Linux text fields keep copy/paste without it, and
    // createWindow restores Ctrl+Q; macOS keeps the default menu, which
    // carries those editing commands.
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

    // The write-only credential-owner sidecar was removed (#371); delete any
    // file an older build left behind. Best-effort and never throws.
    removeLegacyCredentialOwnerStore(app.getPath('userData'))

    // The VRChat session cookie uses OS-first credential storage (VRX-34/282); it is
    // injected so VrcAdapter stays electron-free + unit-testable (VRX-157).
    const vrcCredentials: VrcCredentialStore = {
      load: () => loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY),
      save: (cookie) => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, cookie),
      delete: () => clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)
    }
    // Live-pipeline wiring (VRX-146): the real socket carries the required
    // User-Agent (same policy as REST — VRX-129); logs route through the
    // redaction hook. The adapter itself stays electron-free.
    const friendAlertBoundary: { current?: FriendAlerts } = {}
    const activityBoundary: { current?: ActivityFeed } = {}
    const inboxBoundary: { current?: InboxService } = {}
    const exploreBoundary: { current?: ExploreService } = {}
    const avatarLibraryBoundary: { current?: AvatarLibraryService } = {}
    const communityBoundary: { current?: CommunityService } = {}
    const accountSession = new AccountSession()
    const accountRegistry = new AccountRegistry(accountSession)
    const socialStore = new SocialStore(accountSession)
    const alertPicks = new FriendAlertPicks(accountSession, socialStore)
    const linkGraph = new LinkGraphStore()
    const locationAuthority = new LocationAuthority({
      clock: () => performance.now(),
      log: (level, message, meta) => log[level](message, meta)
    })
    const vrcAdmission = new ApiAdmissionController()
    const cvrAdmission = new ApiAdmissionController()
    // World and group names wait in the same one-per-second line as everything
    // else; keep them per account so the first roster after launch has them.
    const vrcMetadataStore = new VrcMetadataStore({
      directory: join(app.getPath('userData'), VRC_METADATA_DIRECTORY),
      log: (message, meta) => log.warn(message, meta)
    })
    const vrcAdapter = new VrcAdapter(vrcCredentials, vrcAdmission, {
      metadataStore: vrcMetadataStore,
      captureRosterRevision: () => locationAuthority.captureSeedRevision('vrchat'),
      // handshakeTimeout bounds a black-holed connect so the reconnect backoff
      // can retry instead of waiting for the OS default (~1-2 min).
      socketFactory: createVrcSocket,
      log: (level, message, meta) => log[level](message, meta),
      onIdentity: (accountId) => {
        accountSession.setIdentity('vrchat', accountId)
      },
      onSessionBoundary: ({ identityRetained }) => {
        friendAlertBoundary.current?.resetPlatform('vrchat')
        // The same account after a data-path 401 keeps its activity and inbox.
        activityBoundary.current?.resetPlatform('vrchat', { keepEntries: identityRetained })
        if (!identityRetained) inboxBoundary.current?.resetPlatform('vrchat')
        locationAuthority.clearPlatform('vrchat')
        exploreBoundary.current?.clearPlatform('vrchat')
        avatarLibraryBoundary.current?.clearPlatform('vrchat')
        communityBoundary.current?.clearPlatform('vrchat')
        // A data-path 401 keeps the same account and is followed by
        // auth-invalidated, which quarantines the renderer. Sending an identity
        // boundary too would read as an account switch: it refetched the dead
        // roster and wiped unsaved note drafts.
        if (!identityRetained) {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
              window.webContents.send('identity-boundary', { platform: 'vrchat' })
            }
          }
        }
        // VRX-202: auth changed — cached avatar FAILURES (401s from the old
        // auth state) are stale; successes are auth-invariant and stay.
        avatarCache.clearNegativeEntries()
      }
    })
    // CVR session = { username, accessKey } persisted as ONE encrypted credential
    // (VRX-37/174/56). Startup only restores VRX's own stored session; it never
    // looks for game profiles or CVRX. Those are read only when the user presses
    // "Use my sign-in from this PC" (sessionImport.ts), and CvrAdapter validates
    // the imported key and its owner before persisting it.
    const loadStoredCvrCredentials = (): CVRCredentials | undefined => {
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
    }
    let initialCvrCredentials: CVRCredentials | undefined
    try {
      initialCvrCredentials = loadStoredCvrCredentials()
    } catch {
      // A locked keychain must not block app boot; the slot stays untouched.
      log.warn('CVR stored session unreadable')
    }
    const cvrCredentials: CvrCredentialStore = {
      load: () => initialCvrCredentials,
      save: (credentials) =>
        saveCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, JSON.stringify(credentials)),
      delete: () => clearCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY),
      signOut: () => signOutCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY)
    }
    // CVR live pipeline (VRX-58): credentials ride in the upgrade HEADERS
    // (Username/AccessKey/User-Agent/Platform — same as REST, VRX-129), so the
    // socketFactory forwards them verbatim; logs route through the redaction hook.
    const cvrAdapter = new CvrAdapter(cvrCredentials, cvrAdmission, {
      captureRosterRevision: () => locationAuthority.captureSeedRevision('chilloutvr'),
      // Same black-hole guard as the VRChat pipeline (audit OP-A4).
      socketFactory: createCvrSocket,
      log: (level, message, meta) => log[level](message, meta),
      onIdentity: (accountId) => {
        accountSession.setIdentity('chilloutvr', accountId)
      },
      onSessionBoundary: ({ identityRetained }) => {
        // A same-account key rotation changes nothing account-scoped. Clearing
        // here would make Join report stale until the next roster read, and the
        // renderer boundary would refetch the roster and drop note drafts.
        if (identityRetained) return
        friendAlertBoundary.current?.resetPlatform('chilloutvr')
        activityBoundary.current?.resetPlatform('chilloutvr')
        inboxBoundary.current?.resetPlatform('chilloutvr')
        locationAuthority.clearPlatform('chilloutvr')
        exploreBoundary.current?.clearPlatform('chilloutvr')
        avatarLibraryBoundary.current?.clearPlatform('chilloutvr')
        communityBoundary.current?.clearPlatform('chilloutvr')
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
    const appStatus = new AppStatusService()

    const showFriendAlert = createFriendNotificationNotifier({
      icon,
      focusMainWindow,
      focusDashboard,
      // Never log native error text or alert contents: either may contain a
      // friend's display name.
      logFailure: () => log.warn('friend notification failed')
    })
    // The same alerts in the VR headset through XSOverlay when the user turned
    // that on (vrOverlayAlerts.ts). Loopback only; the icon is made once.
    let vrAlertIcon: string | null | undefined
    const vrOverlayAlerts = createVrOverlayAlerts({
      getSettings: getSettingsSnapshot,
      iconBase64: () => {
        if (vrAlertIcon === undefined) {
          const image = nativeImage
            .createFromPath(icon)
            .resize({ width: 64, height: 64, quality: 'best' })
          vrAlertIcon = image.isEmpty() ? null : image.toPNG().toString('base64')
        }
        return vrAlertIcon
      },
      logFailure: () => log.warn('VR alert failed')
    })
    const showAlert = (alert: NativeAlert): void => {
      showFriendAlert(alert)
      vrOverlayAlerts.notify(alert)
    }

    const friendAlerts = new FriendAlerts({
      notify: showAlert,
      // Monotonic time keeps limiter windows correct across wall-clock adjustments.
      clock: () => performance.now(),
      isEnabled: (type) => isFriendAlertEnabled(type, getSettingsSnapshot()),
      isFriendIncluded: (platform, platformUserId) =>
        isFriendAlertIncluded(getSettingsSnapshot(), () =>
          alertPicks.isPicked(platform, platformUserId)
        ),
      hotInstanceThreshold: () => getSettingsSnapshot().hotInstanceThreshold,
      resolveName: (platform, platformUserId) =>
        platform === 'chilloutvr' ? cvrAdapter.resolveFriendName(platformUserId) : null
    })
    friendAlertBoundary.current = friendAlerts

    // The Activity page's list (activityFeed.ts): memory only, fed by the same
    // events as the alerts, no requests. Changes reach the renderer coalesced.
    let activityPushTimer: ReturnType<typeof setTimeout> | null = null
    const activityFeed = new ActivityFeed({
      now: () => Date.now(),
      clock: () => performance.now(),
      isEnabled: () => getSettingsSnapshot().showActivityPage,
      resolveName: (platform, platformUserId) =>
        platform === 'chilloutvr' ? cvrAdapter.resolveFriendName(platformUserId) : null,
      onChanged: () => {
        if (activityPushTimer !== null) return
        activityPushTimer = setTimeout(() => {
          activityPushTimer = null
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send('activity-changed')
          }
        }, ACTIVITY_PUSH_COALESCE_MS)
        activityPushTimer.unref()
      }
    })
    activityBoundary.current = activityFeed
    // View-only inbox: socket-delivered invites and requests, memory only.
    const inbox = new InboxService({
      now: () => Date.now(),
      clock: () => performance.now(),
      onChanged: () => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send('inbox-changed')
        }
      },
      notify: (item) => showAlert({ type: 'inbox', item }),
      isAlertEnabled: (kind) => isInboxAlertEnabled(kind, getSettingsSnapshot())
    })
    inboxBoundary.current = inbox

    // VRX-202: the avatar fetcher needs the live VRChat auth cookie (the image
    // endpoint 401s unauthenticated). Each operation captures its own session lease.
    avatarCache.setApiAdmission(vrcAdmission)
    avatarCache.setVrcSessionProvider(() => vrcAdapter.getAvatarRequestLease())
    // VRChat pictures each cost a slot in the one-per-second line; keep them on
    // disk so the next launch shows them without requests (imageDiskStore.ts).
    avatarCache.setDiskStore(
      new ImageDiskStore({
        directory: join(app.getPath('userData'), IMAGE_DISK_DIRECTORY),
        allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
        maxBodyBytes: AVATAR_MAX_BODY_BYTES,
        log: (message, meta) => log.warn(message, meta)
      })
    )
    // Friend pictures show at most 64 px; keep a small copy instead of the
    // full-size profile icon (avatarRendition.ts).
    avatarCache.setAvatarRenditionMaker(
      createAvatarRenditionMaker((bytes) => nativeImage.createFromBuffer(bytes))
    )

    const joinCoordinator = new JoinCoordinator()
    const gameHandoff = new GameHandoff({
      hostPlatform: process.platform,
      isRunning: (() => {
        const games = new RunningGames(processNameListerFor(process.platform))
        return (platform: Platform) => games.isRunning(platform)
      })(),
      settings: () => getSettingsSnapshot(),
      openExternal: (url) => shell.openExternal(url)
    })
    const explore = new ExploreService({
      adapters: new Map<Platform, ExploreAdapter & Pick<IPlatformAdapter, 'buildJoinUrl'>>([
        ['vrchat', vrcAdapter],
        ['chilloutvr', cvrAdapter]
      ]),
      accountSession,
      admissions: new Map([
        ['vrchat', vrcAdmission],
        ['chilloutvr', cvrAdmission]
      ]),
      joinCoordinator,
      isJoinAllowed: () => getSettingsSnapshot().allowJoinInstances,
      getImage: (url) => avatarCache.get(url),
      openExternal: (url) => shell.openExternal(url),
      deliverJoin: (platform, url, location, stillCurrent) =>
        gameHandoff.deliver(
          platform,
          url,
          () => (platform === 'vrchat' ? vrcAdapter : cvrAdapter).selfInvite(location),
          stillCurrent
        ),
      onChanged: (platform) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send('explore-changed', { platform })
        }
      }
    })
    exploreBoundary.current = explore
    exploreWindowService = explore
    // The Avatars page: own avatars, the worn one, and a user-clicked switch.
    const avatarLibrary = new AvatarLibraryService({
      adapters: new Map<Platform, AvatarLibraryAdapter>([
        ['vrchat', vrcAdapter],
        ['chilloutvr', cvrAdapter]
      ]),
      log: (message, meta) => log.warn(message, meta)
    })
    avatarLibraryBoundary.current = avatarLibrary
    // The Dashboard's "Wearing now": only the worn avatar, one request a read.
    const currentAvatar = new CurrentAvatarService({
      adapters: new Map<Platform, AvatarLibraryAdapter>([
        ['vrchat', vrcAdapter],
        ['chilloutvr', cvrAdapter]
      ]),
      log: (message, meta) => log.warn(message, meta)
    })

    // Profiles, search, Explore's other lists, players online, and groups.
    // Read-only; world results borrow Explore's references and sheet.
    const community = new CommunityService({
      adapters: new Map<Platform, CommunityAdapter>([
        ['vrchat', vrcAdapter],
        ['chilloutvr', cvrAdapter]
      ]),
      adoptWorlds: (platform, evidence) => explore.adoptWorlds(platform, evidence),
      isFriend: (platform, userId) => locationAuthority.hasFriend(platform, userId),
      log: (message, meta) => log.warn(message, meta)
    })
    communityBoundary.current = community

    registerIpcHandlers(adapters, {
      explore,
      inbox,
      vrOverlayAlerts,
      avatarLibrary,
      currentAvatar,
      community,
      // Settings → Appearance background picture (appBackground.ts).
      appBackground: {
        store: new AppBackgroundStore({
          directory: join(app.getPath('userData'), APP_BACKGROUND_DIRECTORY),
          decode: (bytes) => nativeImage.createFromBuffer(bytes),
          fromBitmap: (bitmap, size) => nativeImage.createFromBitmap(bitmap, size),
          log: (message, meta) => log.warn(message, meta)
        }),
        pickFile: async (event) => {
          const owner = BrowserWindow.fromWebContents(event.sender)
          const options: Electron.OpenDialogOptions = {
            title: mt('appBackground.dialogTitle'),
            properties: ['openFile'],
            filters: [
              { name: mt('appBackground.dialogFilter'), extensions: ['png', 'jpg', 'jpeg'] }
            ]
          }
          const picked = owner
            ? await dialog.showOpenDialog(owner, options)
            : await dialog.showOpenDialog(options)
          return picked.canceled ? null : (picked.filePaths[0] ?? null)
        }
      },
      onSettingsApplied: (saved) => {
        applyWindowTheme(saved.theme)
        applyUpdaterSettings(saved)
        // Turning the Activity page off also forgets what it kept.
        if (!saved.showActivityPage) activityFeed.clearAll()
      },
      accountRegistry,
      accountSession,
      socialStore,
      alertPicks,
      links: {
        linkGraph,
        onChanged: () => {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send('linked-profiles-changed')
          }
        }
      },
      appStatus,
      activity: activityFeed,
      importSession: createSessionImporter({
        discoverVrchat: importVrcxSession,
        discoverChilloutvr: () =>
          importCvrSession({
            appDataPath: app.getPath('appData'),
            homePath: app.getPath('home'),
            platform: process.platform,
            environment: process.env
          }),
        vrchat: vrcAdapter,
        chilloutvr: cvrAdapter
      }),
      onLogout: (platform) => {
        if (platform !== 'vrchat') return
        vrcMetadataStore.clearAll()
        void avatarCache.clearStoredImages()
      },
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
      onRendererHydrated,
      onFriendRoster: (platform, friends) => {
        // Settle requests first: it cannot throw, and an alert failure must not skip it.
        inbox.settleRoster(platform, friends)
        friendAlerts.seedRoster(platform, friends)
        activityFeed.seedRoster(platform, friends)
      },
      instance: {
        joinCoordinator,
        gameHandoff,
        isJoinAllowed: () => getSettingsSnapshot().allowJoinInstances,
        clock: () => performance.now(),
        log: (_level, message, meta) => log.warn(message, meta)
      }
    })

    // Broadcast live adapter events to every window over the typed push
    // channel ('friend-event', @shared/ipc). The renderer applies them to the
    // TanStack cache — presence is PUSHED, never polled (CLAUDE.md). Both
    // platforms share one broadcaster; the renderer keys events by platform.
    const broadcast = (event: BroadcastAdapterEvent): void => {
      if (event.type === 'auth-invalidated') {
        explore.clearPlatform(event.platform)
        avatarLibrary.clearPlatform(event.platform)
        community.clearPlatform(event.platform)
      }
      const published = { ...event, rosterRevision: locationAuthority.captureEventRevision() }
      for (const window of BrowserWindow.getAllWindows()) {
        // Guard a window torn down between enumeration and send.
        if (!window.isDestroyed()) window.webContents.send('friend-event', published)
      }
    }
    const teardownAdapterEvents = wireAdapterEvents({
      sources: [vrcAdapter, cvrAdapter],
      appStatus,
      locationAuthority,
      friendAlerts,
      activityFeed,
      inbox,
      broadcast
    })
    // A socket can look open after sleep while its connection is gone.
    const stopWakeReconnect = reconnectLiveOnWake(powerMonitor, [vrcAdapter, cvrAdapter], {
      logFailure: () => log.warn('live reconnect after wake failed')
    })
    app.on('before-quit', () => {
      explore.dispose()
      // Renderer changes are handed to main immediately; force the latest
      // coalesced snapshot to disk before window teardown can discard it.
      flushPendingSettingsSave()
      // Close both sockets and halt the reconnect loops so quit is clean.
      // Wrapped: a throwing teardown must never skip the quitting flag.
      try {
        stopWakeReconnect()
        teardownAdapterEvents()
      } catch (error) {
        log.warn('adapter teardown threw during before-quit', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
      // Single source of truth for every quit path (tray Quit, Cmd+Q, dock,
      // app menu) — before-quit always fires before a window's own 'close'
      // event, so the close-to-tray handler in createWindow() always sees the
      // up-to-date value. autoUpdater.quitAndInstall() routes through
      // app.quit(), so this latch is also correct for restart-to-update.
      quitting = true
    })

    // getOrCreateMainWindow, not a bare createWindow: if a second-instance
    // focus (or any future pre-bootstrap path) already created the window,
    // reuse it instead of spawning a duplicate the tray never wires (Kimi
    // review, VRX-230).
    currentWindow = getOrCreateMainWindow()
    // Tray Show goes through focusMainWindow so it also restores a minimized
    // window and recreates one macOS destroyed on close.
    trayHandle = createTray(
      () => currentWindow,
      () => {
        focusMainWindow()
      }
    )
    trayHandle.wireWindow(currentWindow)
    bootstrapReadyForFocus = true
    if (secondInstanceFocusPending) {
      secondInstanceFocusPending = false
      focusMainWindow()
    }
    if (process.platform === 'win32') {
      // Windows can activate a toast after its instance object was collected or
      // after a cold start; the central handler complements the instance click.
      NativeNotification.handleActivation(focusMainWindow)
    }

    // Check GitHub Releases for updates shortly after startup (packaged builds
    // only). The delay keeps electron-updater's module load off the path to the
    // first window and the first account reads. A failed load is logged, never
    // thrown: auto-update failure is never worth killing a healthy session
    // (audit W7 review).
    setTimeout(() => {
      initAutoUpdater()
        .then((updater) => {
          void updater.check()
        })
        .catch((error: unknown) => {
          log.warn('autoUpdater init failed', {
            message: error instanceof Error ? error.message : String(error)
          })
        })
    }, STARTUP_CHECK_DELAY_MS)

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
    // Without a window the user would see nothing at all.
    showFatalErrorBox('startup')
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
