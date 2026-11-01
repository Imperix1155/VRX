import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import type { IpcHandlerOptions } from './index'

type InvokeHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown
type NotificationHandler = (event: IpcMainEvent) => void

const electron = vi.hoisted(() => {
  const invokeHandlers = new Map<string, InvokeHandler>()
  const notificationHandlers = new Map<string, NotificationHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: InvokeHandler) => {
      invokeHandlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: NotificationHandler) => {
      notificationHandlers.set(channel, handler)
      return ipcMain
    }),
    removeAllListeners: vi.fn((channel: string) => {
      notificationHandlers.delete(channel)
      return ipcMain
    }),
    handleOnce: vi.fn()
  }
  return { invokeHandlers, notificationHandlers, ipcMain }
})

const security = vi.hoisted(() => ({ trustedFrame: {} }))

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }))
vi.mock('./security', () => ({
  isTrustedIpcSender: (frame: unknown) => frame === security.trustedFrame
}))

vi.mock('./friends', () => ({
  registerFriendsHandlers: () =>
    electron.ipcMain.handle('get-friends', () => [{ platformUserId: 'friend' }])
}))
vi.mock('./avatar', () => ({
  registerAvatarHandlers: () =>
    electron.ipcMain.handle('get-avatar', () => ({ ok: true, dataUrl: 'data:image/png;base64,x' }))
}))
vi.mock('./accounts', () => ({
  registerAccountsHandlers: () => electron.ipcMain.handle('get-accounts', () => [])
}))
vi.mock('./auth', () => ({
  registerAuthHandlers: () => {
    electron.ipcMain.handle('get-auth-status', () => ({ state: 'unauthenticated' }))
    electron.ipcMain.handle('login', () => ({ ok: true }))
    electron.ipcMain.handle('verify-2fa', () => ({ ok: true }))
    electron.ipcMain.handle('import-session', () => ({ ok: true }))
    electron.ipcMain.handle('logout', () => undefined)
  }
}))
vi.mock('./notes', () => ({
  registerNotesHandlers: () => {
    electron.ipcMain.handle('get-friend-note', () => ({ note: null }))
    electron.ipcMain.handle('set-friend-note', () => ({ ok: true }))
  }
}))
vi.mock('./links', () => ({
  registerLinksHandlers: () => {
    electron.ipcMain.handle('get-linked-profiles', () => ({
      ok: true,
      value: { profiles: [], lease: 'fixture' }
    }))
    electron.ipcMain.handle('change-linked-profile', () => ({
      ok: true,
      value: { profiles: [], lease: 'fixture' }
    }))
  }
}))
vi.mock('./instance', () => ({
  registerInstanceHandlers: () => {
    electron.ipcMain.handle('join-instance', () => ({ ok: true }))
    electron.ipcMain.handle('self-invite', () => ({ ok: true }))
    electron.ipcMain.handle('get-join-handoff', () => 'launch')
  }
}))
vi.mock('./app-status', () => ({
  registerAppStatusHandlers: () => electron.ipcMain.handle('get-app-status', () => ({ ok: true }))
}))
vi.mock('./activity', () => ({
  registerActivityHandlers: () => {
    electron.ipcMain.handle('get-activity', () => [])
    electron.ipcMain.handle('clear-activity', () => undefined)
  }
}))
vi.mock('./launch', () => ({
  registerLaunchHandlers: () => {
    electron.ipcMain.handle('open-url', () => undefined)
    electron.ipcMain.handle('open-logs-folder', () => undefined)
    electron.ipcMain.handle('open-bug-report', () => undefined)
  }
}))
vi.mock('./app-background', () => ({
  registerAppBackgroundHandlers: () => {
    electron.ipcMain.handle('get-app-background', () => null)
    electron.ipcMain.handle('choose-app-background', () => ({ ok: false, reason: 'cancelled' }))
    electron.ipcMain.handle('clear-app-background', () => undefined)
  }
}))
vi.mock('./vr-alerts', () => ({
  registerVrAlertHandlers: () => electron.ipcMain.handle('test-vr-alert', () => ({ ok: true }))
}))
vi.mock('./inbox', () => ({
  registerInboxHandlers: () => {
    electron.ipcMain.handle('get-inbox', () => ({ items: [] }))
    electron.ipcMain.handle('dismiss-inbox-item', () => undefined)
    electron.ipcMain.handle('clear-inbox', () => undefined)
  }
}))
vi.mock('./settings', () => ({
  registerSettingsHandlers: () => {
    electron.ipcMain.handle('get-settings', () => ({ theme: 'dark' }))
    electron.ipcMain.handle('save-settings', () => ({ theme: 'dark' }))
  }
}))
const updaterService = vi.hoisted(() => ({
  snapshot: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn()
}))
vi.mock('../updater', () => ({
  getUpdaterService: () => updaterService,
  getUpdaterSnapshot: () => updaterService.snapshot(),
  initAutoUpdater: () => Promise.resolve(updaterService)
}))

import { registerIpcHandlers } from './index'

const invokeEvent = { senderFrame: security.trustedFrame } as unknown as IpcMainInvokeEvent
const untrustedInvokeEvent = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const notificationEvent = { senderFrame: security.trustedFrame } as unknown as IpcMainEvent
const untrustedNotificationEvent = { senderFrame: {} } as unknown as IpcMainEvent
let now = 0
let warn: ReturnType<typeof vi.fn>
let hydrated: ReturnType<typeof vi.fn>

function options(): IpcHandlerOptions {
  return {
    accountRegistry: {},
    accountSession: {},
    locationAuthority: {},
    socialStore: {},
    alertPicks: {},
    links: { linkGraph: {} },
    appStatus: {},
    appBackground: {} as IpcHandlerOptions['appBackground'],
    inbox: {} as IpcHandlerOptions['inbox'],
    vrOverlayAlerts: { test: async () => undefined },
    explore: {
      setActive: vi.fn(),
      getSnapshot: vi.fn(),
      getWorld: vi.fn(),
      cancelWorld: vi.fn(),
      getImage: vi.fn(),
      joinRoom: vi.fn(() => ({ ok: true }))
    },
    homeWorld: { setHomeWorld: vi.fn() },
    avatarLibrary: {
      getLibrary: vi.fn(),
      getDetails: vi.fn(),
      switchAvatar: vi.fn()
    },
    currentAvatar: { getCurrent: vi.fn() },
    community: {
      getProfile: vi.fn(),
      getProfileWorlds: vi.fn(),
      getProfileGroups: vi.fn(),
      search: vi.fn(),
      getWorldList: vi.fn(),
      getPlayersOnline: vi.fn(),
      getMyGroups: vi.fn()
    },
    social: { getRelationship: vi.fn(), act: vi.fn() },
    onRendererHydrated: hydrated,
    rateLimit: {
      clock: () => now,
      warn
    }
  } as unknown as IpcHandlerOptions
}

beforeEach(() => {
  electron.invokeHandlers.clear()
  electron.notificationHandlers.clear()
  electron.ipcMain.handle.mockClear()
  electron.ipcMain.on.mockClear()
  electron.ipcMain.removeAllListeners.mockClear()
  electron.ipcMain.handleOnce.mockClear()
  updaterService.snapshot.mockReset().mockReturnValue({ state: 'idle' })
  updaterService.check.mockReset()
  updaterService.download.mockReset()
  updaterService.install.mockReset()
  now = 0
  warn = vi.fn()
  hydrated = vi.fn()
})

describe('registerIpcHandlers rate limiting', () => {
  it('wraps updater:check with the real rate limiter and denies past budget', async () => {
    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())
    const check = electron.invokeHandlers.get('updater:check')!

    const accepted: unknown[] = []
    for (let request = 0; request < 6; request += 1) {
      accepted.push(check(invokeEvent))
    }
    // The handler awaits the shared lazy updater load before delegating.
    await Promise.all(accepted)
    expect(updaterService.check).toHaveBeenCalledTimes(6)

    expect(() => check(invokeEvent)).toThrowError('rate_limited')
    expect(updaterService.check).toHaveBeenCalledTimes(6)
  })

  it('wraps all invoke channels and restores ipcMain.handle after registration', () => {
    const originalHandle = electron.ipcMain.handle

    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())

    expect(electron.invokeHandlers.size).toBe(56)
    expect(electron.ipcMain.handle).toBe(originalHandle)
    expect(electron.invokeHandlers.get('get-settings')!(invokeEvent)).toEqual({ theme: 'dark' })
  })

  it('registers only the enumerated VRX channels after main IPC wiring', () => {
    // electron-store registers this renderer bootstrap listener from its
    // constructor even though VRX never calls ElectronStore.initRenderer().
    electron.ipcMain.on('electron-store-get-data', () => undefined)

    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())

    expect([...electron.invokeHandlers.keys()].sort()).toEqual(
      [
        'change-linked-profile',
        'set-explore-active',
        'get-explore',
        'get-explore-world',
        'cancel-explore-world',
        'get-explore-image',
        'join-explore-room',
        'get-accounts',
        'get-alert-picks',
        'get-app-background',
        'choose-app-background',
        'clear-app-background',
        'get-inbox',
        'dismiss-inbox-item',
        'clear-inbox',
        'get-app-status',
        'get-activity',
        'clear-activity',
        'get-auth-status',
        'get-avatar',
        'get-avatar-library',
        'get-current-avatar',
        'get-avatar-details',
        'switch-avatar',
        'get-profile',
        'get-profile-worlds',
        'get-profile-groups',
        'search-community',
        'get-world-list',
        'get-players-online',
        'get-my-groups',
        'get-relationship',
        'social-action',
        'get-friend-note',
        'get-friends',
        'get-join-handoff',
        'get-linked-profiles',
        'get-settings',
        'import-session',
        'join-instance',
        'login',
        'logout',
        'open-url',
        'open-logs-folder',
        'open-bug-report',
        'save-settings',
        'self-invite',
        'set-alert-pick',
        'set-friend-note',
        'set-home-world',
        'test-vr-alert',
        'updater:check',
        'updater:download',
        'updater:get-state',
        'updater:install',
        'verify-2fa'
      ].sort()
    )
    expect([...electron.notificationHandlers.keys()]).toEqual(['renderer-hydrated'])
    expect(electron.ipcMain.handleOnce).not.toHaveBeenCalled()
  })

  it('returns a structured denial for an action channel', () => {
    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())
    const join = electron.invokeHandlers.get('join-instance')!

    for (let request = 0; request < 20; request += 1) {
      expect(join(invokeEvent)).toEqual({ ok: true })
    }
    expect(join(invokeEvent)).toEqual({ ok: false, reason: 'rate-limited' })
  })

  it('throws rate_limited for a query channel', () => {
    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())
    const getFriends = electron.invokeHandlers.get('get-friends')!

    for (let request = 0; request < 12; request += 1) getFriends(invokeEvent)
    expect(() => getFriends(invokeEvent)).toThrowError('rate_limited')
  })

  it('rejects untrusted invokes before they can consume the trusted sender budget', () => {
    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())
    const getFriends = electron.invokeHandlers.get('get-friends')!

    for (let request = 0; request < 12; request += 1) {
      expect(() => getFriends(untrustedInvokeEvent)).toThrowError('Untrusted IPC sender')
    }

    expect(getFriends(invokeEvent)).toEqual([{ platformUserId: 'friend' }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('silently drops excess renderer-hydrated notifications and warns once', () => {
    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())
    const notifyHydrated = electron.notificationHandlers.get('renderer-hydrated')!

    notifyHydrated(notificationEvent)
    notifyHydrated(notificationEvent)
    notifyHydrated(notificationEvent)
    expect(notifyHydrated(notificationEvent)).toBeUndefined()
    expect(notifyHydrated(notificationEvent)).toBeUndefined()

    expect(hydrated).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('IPC rate limit exceeded', {
      channel: 'renderer-hydrated'
    })
  })

  it('drops untrusted renderer-hydrated notifications before they consume the trusted budget', () => {
    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())
    const notifyHydrated = electron.notificationHandlers.get('renderer-hydrated')!

    notifyHydrated(untrustedNotificationEvent)
    notifyHydrated(untrustedNotificationEvent)
    notifyHydrated(untrustedNotificationEvent)
    notifyHydrated(notificationEvent)

    expect(hydrated).toHaveBeenCalledOnce()
    expect(hydrated).toHaveBeenCalledWith(notificationEvent)
    expect(warn).not.toHaveBeenCalled()
  })
})
