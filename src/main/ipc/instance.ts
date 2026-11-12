import { ipcMain, shell } from 'electron'
import type { InstanceActionResult, IpcInvoke } from '@shared/ipc'
import type { JoinMode, Platform } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import type { InstanceInfo } from '@shared/types'
import type { AccountSession } from '../services/accountSession'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { GameHandoff } from '../services/gameHandoff'
import type { InboxService } from '../services/inbox'
import type { LocationAuthority } from '../services/locationAuthority'
import { isTrustedIpcSender } from './security'
import { isAllowedLaunchUrl } from './url-allowlist'
import { JoinCoordinator } from '../services/joinCoordinator'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])
const VALID_JOIN_MODES = new Set<JoinMode>(['desktop', 'vr'])
const JOIN_COOLDOWN_MS = 3_000
const MAX_TARGET_FIELD_LENGTH = 2_048
const MAX_FRIEND_ID_LENGTH = 128
/** `invite:<platform record ID>`, as `InboxService` issues it. */
const MAX_INVITE_ROW_ID_LENGTH = 160
const INVITE_ROW_ID_PATTERN = /^invite:[A-Za-z0-9_:.-]+$/
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
  /** Fences a Join to the account that started it. Without it, no fence. */
  accountSession?: Pick<AccountSession, 'resolve'>
  /** Where invite rows lead. Without it, `join-invite` finds no row. */
  inbox?: Pick<InboxService, 'inviteTarget'>
}

/** An invite names a place and nothing else; the launch link needs no more. */
function inviteInstance(location: { worldId: string; instanceId: string }): InstanceInfo {
  return {
    worldId: location.worldId,
    instanceId: location.instanceId,
    worldName: null,
    thumbnailUrl: null,
    type: 'invite',
    openness: 'invite',
    opennessUnknown: true,
    isGroup: false,
    groupName: null,
    groupId: null,
    groupImageUrl: null,
    region: null,
    userCount: null
  }
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
  /** Capture the signed-in account now; the check fails once it changes. */
  const accountFence = (platform: Platform): (() => boolean) => {
    const session = options.accountSession
    if (!session) return () => true
    const start = session.resolve(platform)
    if (!('ready' in start)) return () => false
    return () => {
      const now = session.resolve(platform)
      return 'ready' in now && now.accountKey === start.accountKey && now.epoch === start.epoch
    }
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

    const stillCurrent = accountFence(req.platform)
    if (!stillCurrent()) return denied(req.platform, 'stale')
    const permit = joins.acquire(req.platform, currentKey!, req.friendId)
    if (!permit) return denied(req.platform, 'cooldown')
    const instance = resolved.friend.instance!
    try {
      const result = await handoff.deliver(
        req.platform,
        url,
        () => adapter.selfInvite(`${instance.worldId}:${instance.instanceId}`),
        stillCurrent
      )
      if (!result.ok) {
        // An invite that went out and failed still waits out the cooldown.
        if (result.reason === 'invite-failed') permit.complete()
        return denied(req.platform, result.reason)
      }
      permit.complete()
      return { ok: true, handoff: result.handoff }
    } finally {
      permit.release()
    }
  })

  // Join the instance an invite row leads to. The row's location was read and
  // shape-checked by the platform pipeline and never left main; the renderer
  // only names the row. From there it is the same path as a friend's Join.
  ipcMain.handle('join-invite', async (event, req: IpcInvoke['join-invite']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (
      !req ||
      !VALID_PLATFORMS.has(req.platform) ||
      typeof req.id !== 'string' ||
      req.id.length > MAX_INVITE_ROW_ID_LENGTH ||
      !INVITE_ROW_ID_PATTERN.test(req.id) ||
      !VALID_JOIN_MODES.has(req.mode)
    ) {
      throw new Error('Invalid join-invite request')
    }
    if (!options.isJoinAllowed()) return denied(req.platform, 'joining-disabled')
    const adapter = adapters.get(req.platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${req.platform}`)
    // Gone (hidden, replaced, or another account's), or it named no instance.
    const target = options.inbox?.inviteTarget(req.platform, req.id) ?? null
    if (target === null) return denied(req.platform, 'stale')
    const { location } = target

    const url = adapter.buildJoinUrl(inviteInstance(location), req.mode)
    if (url === null || !isAllowedLaunchUrl(url)) return denied(req.platform, 'invalid-url')

    const stillCurrent = accountFence(req.platform)
    if (!stillCurrent()) return denied(req.platform, 'stale')
    const destination = hotInstanceKey(req.platform, location.instanceId, location.worldId)
    const permit = joins.acquire(req.platform, destination!, target.senderId)
    if (!permit) return denied(req.platform, 'cooldown')
    try {
      const result = await handoff.deliver(
        req.platform,
        url,
        () => adapter.selfInvite(`${location.worldId}:${location.instanceId}`),
        stillCurrent
      )
      if (!result.ok) {
        if (result.reason === 'invite-failed') permit.complete()
        return denied(req.platform, result.reason)
      }
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
      await adapter.selfInvite(location)
      return { ok: true }
    } catch {
      return denied(req.platform, 'invite-failed')
    } finally {
      // A failed invite waits out the same spacing as one that went through.
      lastActionAt.set(actionKey, clock())
      inFlight.delete(actionKey)
    }
  })
}
