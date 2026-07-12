import { ipcMain, shell } from 'electron'
import type { InstanceActionResult, IpcInvoke } from '@shared/ipc'
import type { JoinMode, Platform } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import type { LocationAuthority } from '../services/locationAuthority'
import { isTrustedIpcSender } from './security'
import { isAllowedLaunchUrl } from './url-allowlist'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])
const VALID_JOIN_MODES = new Set<JoinMode>(['desktop', 'vr'])
const JOIN_COOLDOWN_MS = 3_000

type InstanceLog = (
  level: 'warn',
  message: string,
  meta: { platform: Platform; reason: string }
) => void

export interface InstanceHandlerOptions {
  clock?: () => number
  log?: InstanceLog
}

export function registerInstanceHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  authority: LocationAuthority,
  options: InstanceHandlerOptions = {}
): void {
  const clock = options.clock ?? Date.now
  const log = options.log ?? (() => undefined)
  const inFlight = new Set<Platform>()
  const lastLaunchAt = new Map<Platform, number>()
  const denied = (
    platform: Platform,
    reason: Exclude<InstanceActionResult, { ok: true }>['reason']
  ): InstanceActionResult => {
    log('warn', 'instance action denied', { platform, reason })
    return { ok: false, reason }
  }

  ipcMain.handle('join-instance', async (event, req: IpcInvoke['join-instance']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      typeof req.friendId !== 'string' ||
      !req.friendId ||
      !VALID_JOIN_MODES.has(req.mode)
    ) {
      throw new Error('Invalid join-instance request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    const resolved = authority.resolve(req.platform, req.friendId)
    if (!resolved.ok) return denied(req.platform, resolved.reason)
    if (!isFriendJoinable(resolved.friend)) return denied(req.platform, 'not-joinable')

    const url = adapter.buildJoinUrl(resolved.friend.instance!, req.mode)
    if (url === null || !isAllowedLaunchUrl(url)) return denied(req.platform, 'invalid-url')

    const previous = lastLaunchAt.get(req.platform)
    if (
      inFlight.has(req.platform) ||
      (previous !== undefined && clock() - previous < JOIN_COOLDOWN_MS)
    ) {
      return denied(req.platform, 'cooldown')
    }

    inFlight.add(req.platform)
    try {
      await shell.openExternal(url)
      lastLaunchAt.set(req.platform, clock())
      return { ok: true }
    } finally {
      inFlight.delete(req.platform)
    }
  })

  ipcMain.handle('self-invite', (event, req: IpcInvoke['self-invite']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || req.platform !== 'vrchat' || typeof req.friendId !== 'string' || !req.friendId) {
      throw new Error('Invalid self-invite request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    const resolved = authority.resolve(req.platform, req.friendId)
    if (!resolved.ok) return denied(req.platform, resolved.reason)
    if (!isFriendJoinable(resolved.friend)) return denied(req.platform, 'not-joinable')
    const instance = resolved.friend.instance!
    const location = `${instance.worldId}:${instance.instanceId}`
    return adapter.selfInvite(location).then(() => ({ ok: true }) as const)
  })
}
