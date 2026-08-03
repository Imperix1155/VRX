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
    })
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
    electron.ipcMain.handle('logout', () => undefined)
  }
}))
vi.mock('./notes', () => ({
  registerNotesHandlers: () => {
    electron.ipcMain.handle('get-friend-note', () => ({ note: null }))
    electron.ipcMain.handle('set-friend-note', () => ({ ok: true }))
  }
}))
vi.mock('./instance', () => ({
  registerInstanceHandlers: () => {
    electron.ipcMain.handle('join-instance', () => ({ ok: true }))
    electron.ipcMain.handle('self-invite', () => ({ ok: true }))
  }
}))
vi.mock('./app-status', () => ({
  registerAppStatusHandlers: () => electron.ipcMain.handle('get-app-status', () => ({ ok: true }))
}))
vi.mock('./launch', () => ({
  registerLaunchHandlers: () => electron.ipcMain.handle('open-url', () => undefined)
}))
vi.mock('./settings', () => ({
  registerSettingsHandlers: () => {
    electron.ipcMain.handle('get-settings', () => ({ theme: 'dark' }))
    electron.ipcMain.handle('save-settings', () => ({ theme: 'dark' }))
  }
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
    appStatus: {},
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
  now = 0
  warn = vi.fn()
  hydrated = vi.fn()
})

describe('registerIpcHandlers rate limiting', () => {
  it('wraps all 15 invoke channels and restores ipcMain.handle after registration', () => {
    const originalHandle = electron.ipcMain.handle

    registerIpcHandlers(new Map<Platform, IPlatformAdapter>(), options())

    expect(electron.invokeHandlers.size).toBe(15)
    expect(electron.ipcMain.handle).toBe(originalHandle)
    expect(electron.invokeHandlers.get('get-settings')!(invokeEvent)).toEqual({ theme: 'dark' })
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
