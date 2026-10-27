import { ipcMain, shell } from 'electron'
import type { InstanceActionResult, IpcInvoke } from '@shared/ipc'
import type { JoinMode, Platform } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { GameHandoff } from '../services/gameHandoff'
import type { LocationAuthority } from '../services/locationAuthority'
import { isTrustedIpcSender } from './security'
import { isAllowedLaunchUrl } from './url-allowlist'
import { JoinCoordinator } from '../services/joinCoordinator'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])
const VALID_JOIN_MODES = new Set<JoinMode>(['desktop', 'vr'])
const JOIN_COOLDOWN_MS = 3_000
const MAX_TARGET_FIELD_LENGTH = 2_048
const MAX_FRIEND_ID_LENGTH = 128
type InstanceAction = 'join' | 'self-invite'

type InstanceLog = (
  level: 'warn',
  message: string,
  meta: { platform: Platform; reason: string }
) => void

export interface InstanceHandlerOptions {
  isJoinAllowed: () => boolean
  clock?: () => number
  log?: InstanceLog
  joinCoordinator?: JoinCoordinator
  /** Launch, or reach the game that is already open. Defaults to launch only. */
  gameHandoff?: GameHandoff
}

/** The pre-2026-10-27 behavior: every Join starts the game through its URL. */
function launchOnlyHandoff(): GameHandoff {
  return new GameHandoff({
    hostPlatform: process.platform,
    isRunning: () => Promise.resolve(false),
    settings: () => ({ joinOpenGame: false, vrchatOpenGameJoin: 'go' }),
    openExternal: (url) => shell.openExternal(url)
  })
}

export function registerInstanceHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  authority: LocationAuthority,
  options: InstanceHandlerOptions
): void {
  const clock = options.clock ?? Date.now
  const log = options.log ?? (() => undefined)
  const joins = options.joinCoordinator ?? new JoinCoordinator(clock)
  const handoff = options.gameHandoff ?? launchOnlyHandoff()
  const inFlight = new Set<string>()
  const lastActionAt = new Map<string, number>()
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
      req.friendId.length > MAX_FRIEND_ID_LENGTH ||
      !VALID_JOIN_MODES.has(req.mode) ||
      typeof req.expectedTarget !== 'object' ||
      req.expectedTarget === null ||
      typeof req.expectedTarget.worldId !== 'string' ||
      typeof req.expectedTarget.instanceId !== 'string' ||
      !req.expectedTarget.worldId ||
      !req.expectedTarget.instanceId ||
      req.expectedTarget.worldId.length > MAX_TARGET_FIELD_LENGTH ||
      req.expectedTarget.instanceId.length > MAX_TARGET_FIELD_LENGTH
    ) {
      throw new Error('Invalid join-instance request')
    }
    if (!options.isJoinAllowed()) return denied(req.platform, 'joining-disabled')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    const resolved = authority.resolve(req.platform, req.friendId)
    if (!resolved.ok) return denied(req.platform, resolved.reason)
    if (!isFriendJoinable(resolved.friend)) return denied(req.platform, 'not-joinable')

    // Codex CAS (VRX-239): the renderer-supplied expectedTarget is a compare-
    // and-swap precondition, never launch input. Build the URL ONLY from the
    // main-owned current friend record.
    const currentKey = hotInstanceKey(
      req.platform,
      resolved.friend.instance!.instanceId,
      resolved.friend.instance!.worldId
    )
    const expectedKey = hotInstanceKey(
      req.platform,
      req.expectedTarget.instanceId,
      req.expectedTarget.worldId
    )
    if (currentKey !== expectedKey) return denied(req.platform, 'target-changed')

    const url = adapter.buildJoinUrl(resolved.friend.instance!, req.mode)
    if (url === null || !isAllowedLaunchUrl(url)) return denied(req.platform, 'invalid-url')

    const permit = joins.acquire(req.platform, currentKey!, req.friendId)
    if (!permit) return denied(req.platform, 'cooldown')
    const instance = resolved.friend.instance!
    try {
      const result = await handoff.deliver(req.platform, url, () =>
        adapter.selfInvite(`${instance.worldId}:${instance.instanceId}`)
      )
      if (!result.ok) return denied(req.platform, result.reason)
      permit.complete()
      return { ok: true, handoff: result.handoff }
    } finally {
      permit.release()
    }
  })

  ipcMain.handle('get-join-handoff', async (event, req: IpcInvoke['get-join-handoff']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform))
      throw new Error('Invalid get-join-handoff request')
    return handoff.preview(req.platform)
  })

  ipcMain.handle('self-invite', async (event, req: IpcInvoke['self-invite']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      req.platform !== 'vrchat' ||
      typeof req.friendId !== 'string' ||
      !req.friendId ||
      req.friendId.length > MAX_FRIEND_ID_LENGTH
    ) {
      throw new Error('Invalid self-invite request')
    }
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    const resolved = authority.resolve(req.platform, req.friendId)
    if (!resolved.ok) return denied(req.platform, resolved.reason)
    if (!isFriendJoinable(resolved.friend)) return denied(req.platform, 'not-joinable')
    const instance = resolved.friend.instance!
    const location = `${instance.worldId}:${instance.instanceId}`
    // A public instance needs no invite outside an open game: use Join.
    if (instance.type === 'public') return denied(req.platform, 'invite-failed')
    const actionKey = `${req.platform}:self-invite` satisfies `${Platform}:${InstanceAction}`
    const previous = lastActionAt.get(actionKey)
    if (
      inFlight.has(actionKey) ||
      (previous !== undefined && clock() - previous < JOIN_COOLDOWN_MS)
    ) {
      return denied(req.platform, 'cooldown')
    }

    inFlight.add(actionKey)
    try {
      try {
        await adapter.selfInvite(location)
      } catch {
        return denied(req.platform, 'invite-failed')
      }
      lastActionAt.set(actionKey, clock())
      return { ok: true }
    } finally {
      inFlight.delete(actionKey)
    }
  })
}
