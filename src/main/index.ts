import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import log, { initLogger } from './logger'
import { initAutoUpdater } from './updater'
import { loadSettings } from './services/settings'
import { CREDENTIAL_KEYS, loadCredential, saveCredential } from './services/credentials'
import { VrcAdapter, type VrcCredentialStore } from './services/adapters/VrcAdapter'
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
      shell.openExternal(details.url)
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
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Structured logging first, so anything below is captured (VRX-15).
  initLogger()

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
    save: (cookie) => saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, cookie)
  }
  const adapters = new Map([['vrchat' as const, new VrcAdapter(vrcCredentials)]])
  registerIpcHandlers(adapters)

  createWindow()

  // Check GitHub Releases for updates on startup (packaged builds only).
  initAutoUpdater()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ── Main-process crash handlers (VRX-127) ─────────────────────────────────────
// Registered at module scope (not inside whenReady) so they catch early-boot
// errors before the app is fully initialized.

process.on('uncaughtException', (error: Error) => {
  // Log and let Electron decide whether to quit — don't suppress the exit.
  log.error('uncaughtException', { message: error.message, stack: error.stack })
})

process.on('unhandledRejection', (reason: unknown) => {
  // Log without exiting — an unhandled rejection alone doesn't warrant a crash.
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  log.warn('unhandledRejection', { message, stack })
})
