import { useSyncExternalStore } from 'react'
import type { InstanceActionResult } from '@shared/ipc'
import type { Friend, JoinMode, JoinModePreference, Platform } from '@shared/types'
import type { ExploreRoom, ExploreWorld } from '@shared/explore'
import type { InboxItem } from '@shared/inbox'
import { isFriendJoinable } from '@shared/joinability'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import { useSettingsStore } from '../stores/settings'
import { queryClient } from '../queries/queryClient'
import { friendsQueryKey } from '../queries/friends'
import { appStatusQueryKey, type ConnectionHealthByPlatform } from '../queries/appStatus'

export type JoinFailureReason = Exclude<InstanceActionResult, { ok: true }>['reason'] | 'unknown'

/** A short note after a Join that reached a game which was already open. */
export type JoinNotice = 'in-game' | 'invite-sent'

/** What the line under a Join shows: a typed denial, or a hand-off note. */
export type JoinFeedback = JoinFailureReason | JoinNotice

/** A hand-off note clears on its own after this long. */
const JOIN_NOTICE_MS = 8_000
/**
 * A failure clears on its own too (owner request, 2026-11-11), a little later
 * than a note: it is a full sentence and says what to do next. The next
 * attempt or an account boundary still clears it sooner.
 */
export const JOIN_FAILURE_MS = 10_000
/** At most one friends read per platform this often for a Join main called stale. */
export const STALE_JOIN_REREAD_MIN_MS = 30_000

function noticeFor(result: InstanceActionResult): JoinNotice | null {
  if (!result.ok) return null
  if (result.handoff === 'in-game') return 'in-game'
  if (result.handoff === 'invite') return 'invite-sent'
  return null
}

function isNotice(feedback: JoinFeedback | null): feedback is JoinNotice {
  return feedback === 'in-game' || feedback === 'invite-sent'
}

/**
 * Resolve the wire launch mode when NO dialog picker is involved (VRX-210).
 * VRChat's `vrchat://launch` URI carries no mode selector (verified against
 * VRChat's launch-options docs + VRCX source), so main ignores the value —
 * 'desktop' is a placeholder there. For CVR, an explicit 'vr'/'desktop'
 * preference passes through; 'ask' with the confirmation dialog OFF cannot be
 * honored (there is no one to ask), so it falls back to 'desktop' — the
 * pre-VRX-210 behavior.
 */
export function resolveWireMode(
  friend: { platform: Platform },
  preference: JoinModePreference
): JoinMode {
  if (friend.platform === 'chilloutvr' && preference !== 'ask') return preference
  return 'desktop'
}

export function joinFailureMessageKey(reason: JoinFeedback): string {
  if (reason === 'in-game') return 'friends.joinNotice.inGame'
  if (reason === 'invite-sent') return 'friends.joinNotice.inviteSent'
  // The friend moved, changed privacy, or left the roster: checking the game
  // would be the wrong advice.
  if (reason === 'not-joinable' || reason === 'unknown-friend')
    return 'friends.joinFailure.notJoinable'
  if (reason === 'stale') return 'friends.joinFailure.stale'
  if (reason === 'cooldown') return 'friends.joinFailure.cooldown'
  if (reason === 'rate-limited') return 'friends.joinFailure.rateLimited'
  if (reason === 'target-changed') return 'friends.joinFailure.targetChanged'
  if (reason === 'joining-disabled') return 'friends.joinFailure.joiningDisabled'
  if (reason === 'invite-failed') return 'friends.joinFailure.inviteFailed'
  // Nothing on this PC opened the game's link (often the game isn't installed):
  // the connection has nothing to do with it, and another try won't help.
  if (reason === 'launch-failed') return 'friends.joinFailure.launchFailed'
  return 'friends.joinFailed'
}

/**
 * The line under an invite's Join. An invite has no live feed to wait for:
 * when main no longer has the row (hidden, replaced, another account), the
 * honest answer is that the invite is gone.
 */
export function inviteJoinMessageKey(reason: JoinFeedback): string {
  if (reason === 'stale' || reason === 'not-joinable' || reason === 'unknown-friend')
    return 'inbox.join.gone'
  if (reason === 'invalid-url' || reason === 'target-changed') return 'inbox.join.failed'
  return joinFailureMessageKey(reason)
}

function inviteJoinKey(item: Pick<InboxItem, 'platform' | 'id'>): string {
  return `invite:${item.platform}:${item.id}`
}

/** The composite key both platforms can't collide on (same shape as the
 *  row/list keys — an id alone could collide across platforms). */
function friendJoinKey(friend: { platform: Platform; platformUserId: string }): string {
  return `${friend.platform}:${friend.platformUserId}`
}

/** A hot-instance identity the user has SEEN and accepted. */
export interface JoinTarget {
  key: string
  worldId: string
  instanceId: string
}

/** The dialog's pending confirmation state. Reset only on join success, cancel,
 *  or an ordinary terminal failure — preserved across drift/unavailable so the
 *  user can review or wait for the cache to catch up (VRX-239/241). */
export interface FriendPendingConfirm {
  source: 'friend'
  /** Increments per dialog OPEN; keyed for per-open UI reset, never friend
   *  object identity. */
  requestId: number
  platform: Platform
  platformUserId: string
  /** Fallback copy when the live friend disappears. */
  displayName: string
  /** The instance the user reviewed and accepted. */
  reviewedTarget: JoinTarget
  /** When main returns `target-changed`, the `dataUpdatedAt` watermark we must
   *  wait to exceed before another Confirm can proceed. */
  awaitingCacheAfter: number | null
  /** Join came from a hot instance (card or sheet): the user picked the
   *  instance, not this friend, so another friend still there can stand in
   *  (`friendForPending`). */
  fromHotInstance: boolean
}

/** How a `join` was asked for. */
interface JoinOptions {
  /** From a hot instance's card or sheet, through one of its members. */
  fromHotInstance?: boolean
}

/** A discovery-room confirmation is deliberately not represented as a Friend. */
export interface ExplorePendingConfirm {
  source: 'explore'
  requestId: number
  platform: Platform
  world: ExploreWorld
  room: ExploreRoom
  /** Deliberately absent: retained only as optional fields for existing generic join consumers. */
  displayName?: undefined
  reviewedTarget?: undefined
  awaitingCacheAfter?: undefined
}

/**
 * An invite row's confirmation. The renderer knows the row and what it
 * showed; where the invite leads stays in main.
 */
export interface InvitePendingConfirm {
  source: 'invite'
  requestId: number
  platform: Platform
  /** The main-issued row key and nothing more. */
  item: Pick<InboxItem, 'platform' | 'id'>
  senderName: string
  worldName: string | null
  displayName?: undefined
  reviewedTarget?: undefined
  awaitingCacheAfter?: undefined
}

export type PendingConfirm = FriendPendingConfirm | ExplorePendingConfirm | InvitePendingConfirm

type ConfirmPendingResult = 'joined' | 'review-required' | 'unavailable' | 'failed'

interface JoinSnapshot {
  /** True while ANY surface's join is in flight. */
  joining: boolean
  /** The reviewed target awaiting confirmation in the join dialog (VRX-210).
   *  Null = no dialog. */
  pendingConfirm: PendingConfirm | null
  /** The composite key of the friend whose join was denied — the blip is
   *  ATTRIBUTABLE (Codex re-review): only surfaces showing THAT friend blip,
   *  never every joinable pill. Null = no blip. */
  failedFriendId: string | null
  /** Typed main-process denial retained so callers can render honest copy, or
   *  the short note for a Join that reached an already-open game. */
  failureReason: JoinFeedback | null
}

/** What the shared store lets every surface do; `useJoinInstance` hands these out as is. */
interface JoinActions {
  join: (friend: Friend, options?: JoinOptions) => Promise<void>
  joinExplore: (world: ExploreWorld, room: ExploreRoom) => Promise<void>
  /** Join the instance an invite row leads to. `senderName` is the name the
   *  row showed, for the confirmation's copy. */
  joinInvite: (item: InboxItem, senderName: string) => Promise<void>
  confirmPending: (mode: JoinMode) => Promise<ConfirmPendingResult>
  acknowledgePendingTarget: (presentedKey?: string) => boolean
  cancelPending: () => void
  invalidatePending: (platform?: Platform) => void
  invalidateFriendPending: () => void
}

interface JoinStore extends JoinActions {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => JoinSnapshot
}

/**
 * One roster read after main turned a Join down because the friend moved:
 * main is ahead of the renderer cache, and without it the next Join (or the
 * dialog's wait for the new place) could outlive a 'manual' reconcile cadence.
 * A read already running is reused, never restarted.
 */
function readRosterAfterMove(platform: Platform): void {
  void queryClient.refetchQueries({ queryKey: friendsQueryKey(platform) }, { cancelRefetch: false })
}

const lastStaleReread = new Map<Platform, number>()

/**
 * One roster read after main turned a Join down as `stale` while the live
 * connection shows connected: main is waiting for the friends read that
 * follows a reconnect, and this is that read, so the next Join goes through
 * instead of staying refused until some later refresh. Nothing is read while
 * the connection is down (a read cannot settle it then), a read already
 * running is reused, and repeated presses read at most once per
 * `STALE_JOIN_REREAD_MIN_MS`.
 */
function readRosterAfterStale(platform: Platform): void {
  const health = queryClient.getQueryData<ConnectionHealthByPlatform>(appStatusQueryKey)
  if (health?.[platform] !== 'live') return
  const now = Date.now()
  const last = lastStaleReread.get(platform)
  if (last !== undefined && now - last < STALE_JOIN_REREAD_MIN_MS) return
  lastStaleReread.set(platform, now)
  void queryClient.refetchQueries({ queryKey: friendsQueryKey(platform) }, { cancelRefetch: false })
}

/** Whether the friends cache still shows `friend` joinable at `target`. */
function cacheStillShows(friend: Friend, target: JoinTarget): boolean {
  const live = readFriendsCache(friend.platform).friends?.find(
    (f) => f.platformUserId === friend.platformUserId
  )
  return live !== undefined && isFriendJoinable(live) && targetFor(live)?.key === target.key
}

/** Read the latest friends array and the query's dataUpdatedAt watermark for CAS. */
function readFriendsCache(platform: Platform): {
  friends: Friend[] | undefined
  dataUpdatedAt: number
  queryError: Error | null
} {
  const state = queryClient.getQueryState<Friend[], Error>(friendsQueryKey(platform))
  return {
    friends: queryClient.getQueryData<Friend[]>(friendsQueryKey(platform)),
    dataUpdatedAt: state?.dataUpdatedAt ?? 0,
    queryError: state?.error ?? null
  }
}

/** Build the JoinTarget the user is seeing for a live friend. */
function targetFor(friend: Friend): JoinTarget | null {
  if (!friend.instance) return null
  const key = hotInstanceKey(friend.platform, friend.instance.instanceId, friend.instance.worldId)
  if (key === null) return null
  return { key, worldId: friend.instance.worldId, instanceId: friend.instance.instanceId }
}

/**
 * The live friend a parked friend confirmation stands for: the friend Join was
 * pressed for. A Join from a hot instance is for the instance, so once that
 * friend is no longer joinable in the reviewed instance, the first other
 * joinable friend still there by name (the hot card's own order) stands in.
 * Only when nobody is left does the dialog show the move or "no longer
 * available" for the original friend.
 */
export function friendForPending(
  friends: readonly Friend[] | undefined,
  pending: Pick<
    FriendPendingConfirm,
    'platform' | 'platformUserId' | 'reviewedTarget' | 'fromHotInstance'
  >
): Friend | undefined {
  const own = friends?.find((f) => f.platformUserId === pending.platformUserId)
  if (!pending.fromHotInstance || friends === undefined) return own
  const inReviewed = (f: Friend): boolean =>
    f.platform === pending.platform &&
    isFriendJoinable(f) &&
    targetFor(f)?.key === pending.reviewedTarget.key
  if (own !== undefined && inReviewed(own)) return own
  const standIn = friends
    .filter(inReviewed)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))[0]
  return standIn ?? own
}

/**
 * A tiny module-level external store (no new dependencies — consumed via
 * `useSyncExternalStore`). Kimi re-review fix, VRX-69: with per-hook state,
 * OTHER Join buttons looked enabled during a join and their clicks silently
 * no-op'd against the latch, and a blip on one surface survived a success on
 * another. One snapshot means every Join surface disables together and one
 * blip state rules — attributed to the friend that failed. The factory
 * exists so the singleton below is the ONLY instance — a per-hook store
 * would resurrect the split-state bug.
 */
function createJoinStore(): JoinStore {
  let requestId = 0
  /** Monotonic session generation. Advances on every new dialog session and on
   *  explicit invalidation (boundary/unmount). In-flight completions must check
   *  their captured generation before mutating state. */
  let sessionGeneration = 0
  let directJoinPlatform: Platform | null = null
  let snapshot: JoinSnapshot = {
    joining: false,
    pendingConfirm: null,
    failedFriendId: null,
    failureReason: null
  }
  const listeners = new Set<() => void>()
  let noticeTimer: ReturnType<typeof setTimeout> | null = null

  function emit(patch: Partial<JoinSnapshot>): void {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  function clearFailureBlip(): void {
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer)
      noticeTimer = null
    }
    if (snapshot.failedFriendId != null || snapshot.failureReason != null) {
      emit({ failedFriendId: null, failureReason: null })
    }
  }

  /** Show one line of feedback for `friendKey`, then clear it after `ms`. */
  function showFeedback(friendKey: string, feedback: JoinFeedback, ms: number): void {
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    emit({ failedFriendId: friendKey, failureReason: feedback })
    noticeTimer = setTimeout(() => {
      noticeTimer = null
      if (snapshot.failedFriendId === friendKey && snapshot.failureReason === feedback) {
        emit({ failedFriendId: null, failureReason: null })
      }
    }, ms)
  }

  function showFailureBlip(friendKey: string, reason: JoinFailureReason): void {
    // Readable for a while, then gone on its own; the next attempt or a session
    // boundary clears it sooner. Retry still goes through the shared
    // busy/confirmation latch and main admission, and never runs by itself.
    showFeedback(friendKey, reason, JOIN_FAILURE_MS)
  }

  /** After a successful Join: say where it went when it used the open game. */
  function showJoinResult(friendKey: string, result: InstanceActionResult): void {
    clearFailureBlip()
    const notice = noticeFor(result)
    if (notice === null) return
    showFeedback(friendKey, notice, JOIN_NOTICE_MS)
  }

  async function performJoin(friend: Friend, mode: JoinMode): Promise<void> {
    const generation = ++sessionGeneration
    directJoinPlatform = friend.platform
    emit({ joining: true })
    // A new attempt clears any lingering blip immediately (whoever it was for).
    clearFailureBlip()
    const friendKey = friendJoinKey(friend)
    const target = targetFor(friend)
    try {
      // Guard the preload bridge explicitly — it is undefined in Preview and
      // tests (house rule), and a missing bridge is user-equivalent to a denial.
      if (!window.vrx) {
        showFailureBlip(friendKey, 'unknown')
        return
      }
      if (target === null) {
        showFailureBlip(friendKey, 'not-joinable')
        return
      }
      const result = await window.vrx.joinInstance({
        platform: friend.platform,
        friendId: friend.platformUserId,
        mode,
        expectedTarget: { worldId: target.worldId, instanceId: target.instanceId }
      })
      if (generation !== sessionGeneration) return
      if (result.ok) {
        showJoinResult(friendKey, result)
      } else {
        showFailureBlip(friendKey, result.reason)
        // Main turned down the place the list still shows, so its record is
        // ahead of the cache and every retry would send the same old target:
        // read the roster once, as Confirm does. A moved friend's live update
        // has usually landed by now; then the list shows the new place and
        // nothing is read.
        if (result.reason === 'target-changed' && cacheStillShows(friend, target)) {
          readRosterAfterMove(friend.platform)
        }
        if (result.reason === 'stale') readRosterAfterStale(friend.platform)
      }
    } catch {
      // Bridge exceptions are user-equivalent to a denial: blip, never an
      // unhandled rejection.
      if (generation === sessionGeneration) showFailureBlip(friendKey, 'unknown')
    } finally {
      if (generation === sessionGeneration) {
        directJoinPlatform = null
        emit({ joining: false })
      }
    }
  }

  async function join(friend: Friend, options: JoinOptions = {}): Promise<void> {
    // The snapshot IS the cross-surface latch: one active join blocks all.
    if (snapshot.joining) return
    // The confirmation dialog is MODAL: while one is parked, a join request
    // (for ANY friend) must not silently swap or stack — ignore it.
    if (snapshot.pendingConfirm !== null) return
    // VRX-210: the confirmation gate lives HERE, in the ONE shared flow, so
    // every join path — the row pill, the drawer button, and the hot-instance
    // card Join (VRX-237) — is intercepted identically. `confirmJoin: false`
    // keeps one-click joining.
    const { allowJoinInstances, confirmJoin, joinMode } = useSettingsStore.getState().settings
    if (!allowJoinInstances) {
      clearFailureBlip()
      showFailureBlip(friendJoinKey(friend), 'joining-disabled')
      return
    }
    if (confirmJoin) {
      // Opening the dialog is a new attempt too: clear any lingering blip.
      clearFailureBlip()
      if (!isFriendJoinable(friend)) {
        showFailureBlip(friendJoinKey(friend), 'not-joinable')
        return
      }
      const target = targetFor(friend)
      if (target === null) return
      requestId += 1
      sessionGeneration += 1
      emit({
        pendingConfirm: {
          source: 'friend',
          requestId,
          platform: friend.platform,
          platformUserId: friend.platformUserId,
          displayName: friend.displayName,
          reviewedTarget: target,
          awaitingCacheAfter: null,
          fromHotInstance: options.fromHotInstance === true
        }
      })
      return
    }
    await performJoin(friend, resolveWireMode(friend, joinMode))
  }

  function exploreJoinKey(world: ExploreWorld, room: ExploreRoom): string {
    return `explore:${world.platform}:${world.worldId}:${room.roomId}`
  }

  async function performExploreJoin(
    world: ExploreWorld,
    room: ExploreRoom,
    mode: JoinMode
  ): Promise<ConfirmPendingResult> {
    const generation = ++sessionGeneration
    directJoinPlatform = world.platform
    emit({ joining: true })
    clearFailureBlip()
    const key = exploreJoinKey(world, room)
    try {
      if (!window.vrx?.joinExploreRoom || room.action.state !== 'available') {
        if (generation === sessionGeneration) showFailureBlip(key, 'not-joinable')
        return 'failed'
      }
      const result = await window.vrx.joinExploreRoom({
        platform: world.platform,
        selectionRef: room.action.selectionRef,
        mode
      })
      if (generation !== sessionGeneration) return 'failed'
      if (result.ok) {
        showJoinResult(key, result)
        return 'joined'
      }
      showFailureBlip(key, result.reason)
      return result.reason === 'target-changed' ? 'review-required' : 'failed'
    } catch {
      if (generation === sessionGeneration) showFailureBlip(key, 'unknown')
      return 'failed'
    } finally {
      if (generation === sessionGeneration) {
        directJoinPlatform = null
        emit({ joining: false, pendingConfirm: null })
      }
    }
  }

  async function joinExplore(world: ExploreWorld, room: ExploreRoom): Promise<void> {
    if (snapshot.joining || snapshot.pendingConfirm !== null) return
    const { allowJoinInstances, confirmJoin, joinMode } = useSettingsStore.getState().settings
    const key = exploreJoinKey(world, room)
    if (!allowJoinInstances) {
      clearFailureBlip()
      showFailureBlip(key, 'joining-disabled')
      return
    }
    if (room.action.state !== 'available') {
      clearFailureBlip()
      showFailureBlip(key, room.action.reason === 'stale' ? 'stale' : 'not-joinable')
      return
    }
    if (confirmJoin) {
      clearFailureBlip()
      requestId += 1
      sessionGeneration += 1
      emit({
        pendingConfirm: { source: 'explore', requestId, platform: world.platform, world, room }
      })
      return
    }
    await performExploreJoin(world, room, resolveWireMode(world, joinMode))
  }

  async function performInviteJoin(
    item: Pick<InboxItem, 'platform' | 'id'>,
    mode: JoinMode
  ): Promise<ConfirmPendingResult> {
    const generation = ++sessionGeneration
    directJoinPlatform = item.platform
    emit({ joining: true })
    clearFailureBlip()
    const key = inviteJoinKey(item)
    try {
      if (!window.vrx?.joinInvite) {
        if (generation === sessionGeneration) showFailureBlip(key, 'unknown')
        return 'failed'
      }
      // Main looks the row up and builds the link; nothing here names a place.
      const result = await window.vrx.joinInvite({ platform: item.platform, id: item.id, mode })
      if (generation !== sessionGeneration) return 'failed'
      if (result.ok) {
        showJoinResult(key, result)
        return 'joined'
      }
      showFailureBlip(key, result.reason)
      return 'failed'
    } catch {
      if (generation === sessionGeneration) showFailureBlip(key, 'unknown')
      return 'failed'
    } finally {
      if (generation === sessionGeneration) {
        directJoinPlatform = null
        emit({ joining: false, pendingConfirm: null })
      }
    }
  }

  async function joinInvite(item: InboxItem, senderName: string): Promise<void> {
    if (snapshot.joining || snapshot.pendingConfirm !== null) return
    if (item.kind !== 'invite' || item.canJoin !== true) return
    const { allowJoinInstances, confirmJoin, joinMode } = useSettingsStore.getState().settings
    if (!allowJoinInstances) {
      clearFailureBlip()
      showFailureBlip(inviteJoinKey(item), 'joining-disabled')
      return
    }
    if (confirmJoin) {
      clearFailureBlip()
      requestId += 1
      sessionGeneration += 1
      emit({
        pendingConfirm: {
          source: 'invite',
          requestId,
          platform: item.platform,
          item: { platform: item.platform, id: item.id },
          senderName,
          worldName: item.worldName
        }
      })
      return
    }
    await performInviteJoin(item, resolveWireMode(item, joinMode))
  }

  async function confirmExplorePending(
    pending: ExplorePendingConfirm,
    mode: JoinMode
  ): Promise<ConfirmPendingResult> {
    return performExploreJoin(pending.world, pending.room, mode)
  }

  async function confirmPending(mode: JoinMode): Promise<ConfirmPendingResult> {
    const pc = snapshot.pendingConfirm
    // The latch applies to confirmed joins as well: Confirm fires exactly once.
    // If the dialog state is gone or a launch is already running, there is no
    // actionable target available.
    if (pc === null || snapshot.joining) return 'unavailable'
    if (pc.source === 'explore') return confirmExplorePending(pc, mode)
    if (pc.source === 'invite') return performInviteJoin(pc.item, mode)

    // Renderer preflight (VRX-239): re-read the TanStack cache synchronously —
    // NEVER the render closure. Fail closed to 'review-required' (drift) or
    // 'unavailable' without calling main.
    const { friends, dataUpdatedAt, queryError } = readFriendsCache(pc.platform)
    if (queryError !== null || friends === undefined) return 'unavailable'
    const live = friendForPending(friends, pc)
    if (!live) return 'unavailable'
    if (!isFriendJoinable(live)) return 'unavailable'
    const liveTarget = targetFor(live)
    if (liveTarget === null) return 'unavailable'
    if (liveTarget.key !== pc.reviewedTarget.key) return 'review-required'
    if (pc.awaitingCacheAfter !== null && dataUpdatedAt <= pc.awaitingCacheAfter) {
      return 'review-required'
    }

    emit({ joining: true })
    clearFailureBlip()
    const generationAtStart = sessionGeneration
    // The friend main is asked about: the one Join was pressed for, or the
    // friend standing in for them in the same hot instance.
    const friendKey = friendJoinKey(live)
    try {
      if (!window.vrx) {
        // The session may have been invalidated while we were not awaiting; do
        // not resurrect UI state for a dead session.
        if (generationAtStart !== sessionGeneration) return 'failed'
        showFailureBlip(friendKey, 'unknown')
        emit({ joining: false, pendingConfirm: null })
        return 'failed'
      }
      const result = await window.vrx.joinInstance({
        platform: pc.platform,
        friendId: live.platformUserId,
        mode,
        expectedTarget: {
          worldId: pc.reviewedTarget.worldId,
          instanceId: pc.reviewedTarget.instanceId
        }
      })
      // The dialog session may have been invalidated (identity boundary, auth
      // invalidated, unmount) while the IPC was in flight. Do not resurrect
      // state for a stale session.
      if (generationAtStart !== sessionGeneration) return 'failed'
      if (result.ok) {
        // Atomic success: focus restoration can happen, joining ends, dialog closes.
        emit({ joining: false, pendingConfirm: null })
        showJoinResult(friendKey, result)
        return 'joined'
      }
      if (result.reason === 'target-changed') {
        // Main's authority is ahead of the renderer cache. Re-read the cache;
        // if it already contains a healthy, DIFFERENT target, enter Review
        // immediately so the dialog is never stranded waiting for an update
        // that has already landed. Otherwise arm the watermark and wait.
        const after = readFriendsCache(pc.platform)
        const afterLive = friendForPending(after.friends, pc)
        const afterTarget = afterLive && isFriendJoinable(afterLive) ? targetFor(afterLive) : null
        if (afterTarget !== null && afterTarget.key !== pc.reviewedTarget.key) {
          emit({
            pendingConfirm: { ...pc, awaitingCacheAfter: null },
            joining: false
          })
          return 'review-required'
        }
        emit({
          pendingConfirm: {
            ...pc,
            awaitingCacheAfter: after.dataUpdatedAt
          },
          joining: false
        })
        readRosterAfterMove(pc.platform)
        return 'review-required'
      }
      // Ordinary terminal failure: clear the dialog and show the attributed blip.
      showFailureBlip(friendKey, result.reason)
      emit({ joining: false, pendingConfirm: null })
      if (result.reason === 'stale') readRosterAfterStale(pc.platform)
      return 'failed'
    } catch {
      if (generationAtStart !== sessionGeneration) return 'failed'
      showFailureBlip(friendKey, 'unknown')
      emit({ joining: false, pendingConfirm: null })
      return 'failed'
    }
  }

  function acknowledgePendingTarget(presentedKey?: string): boolean {
    const pc = snapshot.pendingConfirm
    if (pc === null || snapshot.joining) return false
    if (pc.source !== 'friend') return false
    // Acknowledgment must also be healthy: a failed query can retain stale data,
    // and accepting it would let the dialog launch a target the cache can no
    // longer vouch for.
    const { friends, queryError } = readFriendsCache(pc.platform)
    if (queryError !== null || friends === undefined) return false
    const live = friendForPending(friends, pc)
    if (!live || !isFriendJoinable(live)) return false
    const liveTarget = targetFor(live)
    if (liveTarget === null) return false
    if (presentedKey !== undefined && liveTarget.key !== presentedKey) return false
    emit({
      pendingConfirm: {
        ...pc,
        reviewedTarget: liveTarget,
        awaitingCacheAfter: null
      }
    })
    return true
  }

  function cancelPending(): void {
    // The launch is committed: the modal is inert and Cancel is disabled.
    if (snapshot.joining) return
    if (snapshot.pendingConfirm !== null) {
      sessionGeneration += 1
      emit({ pendingConfirm: null })
    }
  }

  /** Invalidation is stronger than user Cancel: it clears the dialog even while
   *  a launch is settling, and advances the session generation so any late IPC
   *  completion for the old session is ignored. */
  function invalidatePending(platform?: Platform): void {
    if (
      platform !== undefined &&
      snapshot.pendingConfirm?.platform !== platform &&
      directJoinPlatform !== platform &&
      !snapshot.failedFriendId?.startsWith(`${platform}:`) &&
      !snapshot.failedFriendId?.startsWith(`explore:${platform}:`) &&
      !snapshot.failedFriendId?.startsWith(`invite:${platform}:`)
    )
      return
    sessionGeneration += 1
    directJoinPlatform = null
    clearFailureBlip()
    if (snapshot.pendingConfirm !== null || snapshot.joining) {
      emit({ pendingConfirm: null, joining: false })
    }
  }

  function invalidateFriendPending(): void {
    const source = snapshot.pendingConfirm?.source
    if (source === 'explore' || source === 'invite') return
    invalidatePending()
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    join,
    joinExplore,
    joinInvite,
    confirmPending,
    acknowledgePendingTarget,
    cancelPending,
    invalidatePending,
    invalidateFriendPending
  }
}

/** ONE store for the whole renderer — every Join surface shares it. */
const sharedJoinStore = createJoinStore()

/**
 * The ONE join-a-friend flow (VRX-166 row pill · VRX-69 drawer button).
 * All state is GLOBAL via the shared store above: `isJoining` is true on
 * every surface while any join runs (all Join buttons disable together — no
 * enabled-looking button whose click silently no-ops), and the failure
 * feedback, kept for `JOIN_FAILURE_MS` or until the next attempt, is
 * ATTRIBUTED to the friend that failed. `joinFailureFor`
 * retains the typed denial for honest copy, while `joinFailedFor` remains the
 * boolean convenience API. Both clear at the start of a new attempt and on
 * success, wherever it fires. Callers own event concerns. A Join that reached
 * an already-open game puts a short `JoinNotice` in the same attributed slot
 * (`joinFailureFor` returns it; `joinFailedFor` stays false); it clears after
 * `JOIN_NOTICE_MS`.
 *
 * VRX-210: with `settings.confirmJoin` on, `join` does NOT launch — it parks
 * the reviewed target in `pendingConfirm` and the `JoinConfirmDialog` (mounted
 * once in AppShell) owns the choice: `confirmPending(mode)` fires exactly one
 * join, `cancelPending()` fires nothing. With the setting off, `join` launches
 * immediately, resolving the wire mode from `settings.joinMode`.
 *
 * VRX-239/241: the dialog renders from the LIVE friend looked up in the
 * TanStack cache. If the live target drifts from the reviewed target, the
 * dialog enters a DRIFT state (Confirm disabled, Review action) and never
 * silently launches the old target. If the live friend becomes unavailable,
 * the dialog enters an UNAVAILABLE state (Cancel only). Confirm performs a
 * synchronous cache preflight before invoking main, and main compares the
 * renderer's expected target against its authoritative current target.
 * A Join from a hot instance (`{ fromHotInstance: true }`) is for the
 * instance: the live friend is `friendForPending`'s pick, so another friend
 * still there stands in before DRIFT or UNAVAILABLE shows.
 */
export function useJoinInstance(): JoinActions & {
  isJoining: boolean
  pendingConfirm: PendingConfirm | null
  joinFailedFor: (friend: Friend) => boolean
  joinFailureFor: (friend: Pick<Friend, 'platform' | 'platformUserId'>) => JoinFeedback | null
  joinExploreFailureFor: (world: ExploreWorld, room: ExploreRoom) => JoinFeedback | null
  joinInviteFailureFor: (item: Pick<InboxItem, 'platform' | 'id'>) => JoinFeedback | null
} {
  const { joining, pendingConfirm, failedFriendId, failureReason } = useSyncExternalStore(
    sharedJoinStore.subscribe,
    sharedJoinStore.getSnapshot,
    // Server snapshot: the SSR-rendered markup tests (renderToStaticMarkup)
    // read the same module snapshot — no window access happens on read.
    sharedJoinStore.getSnapshot
  )
  return {
    isJoining: joining,
    pendingConfirm,
    joinFailedFor: (friend) => failedFriendId === friendJoinKey(friend) && !isNotice(failureReason),
    joinFailureFor: (friend) => (failedFriendId === friendJoinKey(friend) ? failureReason : null),
    joinExploreFailureFor: (world, room) =>
      failedFriendId === `explore:${world.platform}:${world.worldId}:${room.roomId}`
        ? failureReason
        : null,
    joinInviteFailureFor: (item) => (failedFriendId === inviteJoinKey(item) ? failureReason : null),
    join: sharedJoinStore.join,
    joinExplore: sharedJoinStore.joinExplore,
    joinInvite: sharedJoinStore.joinInvite,
    confirmPending: sharedJoinStore.confirmPending,
    acknowledgePendingTarget: sharedJoinStore.acknowledgePendingTarget,
    cancelPending: sharedJoinStore.cancelPending,
    invalidatePending: sharedJoinStore.invalidatePending,
    invalidateFriendPending: sharedJoinStore.invalidateFriendPending
  }
}
