import type { Platform } from '@shared/types'
import type { AccountSession } from './accountSession'
import {
  FAVORITES_MAX,
  PER_FRIEND_OPT_OUTS_MAX,
  type DoNotDisturbBypassData,
  type PerFriendOptOutsData,
  type SocialPrefsData,
  type SocialStore
} from './socialStore'

const FRIEND_ALERT_KINDS = ['online', 'in-game', 'offline'] as const
export type FriendAlertKind = (typeof FRIEND_ALERT_KINDS)[number]
const STORED_ALERT_TYPES = new Set<string>([...FRIEND_ALERT_KINDS, 'hot-instance'])

export type FriendAlertChange =
  { kind: 'type'; type: FriendAlertKind; enabled: boolean } | { kind: 'bypass'; enabled: boolean }

const FRIEND_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_FRIEND_ID_LENGTH = 128
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Most friends one account can pick for alerts (the SocialStore cap). */
export const ALERT_PICKS_MAX = FAVORITES_MAX

export interface AlertPicksRevision {
  platformAccountId: string
  epoch: number
}

export type AlertPickWriteResult =
  { ok: true } | { ok: false; reason: 'not-authenticated' | 'invalid' | 'stale' | 'full' }

interface CachedPicks {
  accountKey: string
  epoch: number
  ids: Set<string>
  bypassIds: Set<string>
  /** Types this friend turned off. A missing friend has every type on. */
  optOuts: Map<string, Set<string>>
}

export function isValidAlertFriendId(friendId: unknown): friendId is string {
  return (
    typeof friendId === 'string' &&
    friendId.length > 0 &&
    friendId.length <= MAX_FRIEND_ID_LENGTH &&
    !FORBIDDEN_KEYS.has(friendId) &&
    FRIEND_ID_PATTERN.test(friendId)
  )
}

function isFriendIdList(friendIds: unknown): friendIds is string[] {
  return (
    Array.isArray(friendIds) &&
    friendIds.length > 0 &&
    friendIds.length <= ALERT_PICKS_MAX &&
    friendIds.every(isValidAlertFriendId)
  )
}

function isValidRequest(friendIds: unknown, picked: unknown): friendIds is string[] {
  return isFriendIdList(friendIds) && typeof picked === 'boolean'
}

function isFriendAlertKind(value: unknown): value is FriendAlertKind {
  return typeof value === 'string' && (FRIEND_ALERT_KINDS as readonly string[]).includes(value)
}

export function isFriendAlertChange(value: unknown): value is FriendAlertChange {
  if (typeof value !== 'object' || value === null) return false
  const change = value as { kind?: unknown; enabled?: unknown; type?: unknown }
  if (typeof change.enabled !== 'boolean') return false
  if (change.kind === 'bypass') return true
  return change.kind === 'type' && isFriendAlertKind(change.type)
}

function sameRevision(
  revision: AlertPicksRevision | undefined,
  current: AlertPicksRevision
): boolean {
  return (
    revision?.platformAccountId === current.platformAccountId && revision.epoch === current.epoch
  )
}

function applyPicks(
  before: ReadonlySet<string>,
  friendIds: readonly string[],
  picked: unknown
): Set<string> {
  const ids = new Set(before)
  for (const friendId of friendIds) {
    if (picked === true) ids.add(friendId)
    else ids.delete(friendId)
  }
  return ids
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/**
 * Per-account friend alert choices, kept only in SocialStore. Picks are
 * `socialPrefs.followedFriendIds`. Types a friend turned off are
 * `perFriendOptOuts` (a missing friend still has every type on, which is how
 * alerts worked before the toggles). Friends who bypass Do not disturb are
 * `doNotDisturbBypass`. Nothing is sent to a platform. Reads are cached per
 * account and epoch because the alert engine asks on every friend transition.
 */
export class FriendAlertPicks {
  private readonly cache = new Map<Platform, CachedPicks>()

  constructor(
    private readonly accountSession: AccountSession,
    private readonly socialStore: SocialStore
  ) {}

  /** The current account's picks, opt-outs and bypasses, or empty while signed out. */
  list(platform: Platform): {
    friendIds: string[]
    bypassFriendIds: string[]
    optOuts: PerFriendOptOutsData
    revision?: AlertPicksRevision
  } {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return { friendIds: [], bypassFriendIds: [], optOuts: {} }
    const cached = this.cached(platform, revision)
    const optOuts: PerFriendOptOutsData = {}
    for (const [friendId, types] of cached.optOuts) {
      const stored = storedTypes(types)
      if (stored.length > 0) optOuts[friendId] = stored
    }
    return {
      friendIds: [...cached.ids],
      bypassFriendIds: [...cached.bypassIds],
      optOuts,
      revision
    }
  }

  /** Whether the current account picked this friend. Signed out is never picked. */
  isPicked(platform: Platform, friendId: string): boolean {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return false
    return this.cached(platform, revision).ids.has(friendId)
  }

  /**
   * Whether this friend's own switch for the type is on. Missing data is on,
   * so an older file alerts exactly as it did. Signed out is on: nothing here
   * invents a mute, and alerts are not sent without an account anyway.
   */
  isTypeEnabled(platform: Platform, friendId: string, type: FriendAlertKind): boolean {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return true
    return !this.cached(platform, revision).optOuts.get(friendId)?.has(type)
  }

  /** Whether this friend's alerts still go out during Do not disturb. Default off. */
  bypassesDoNotDisturb(platform: Platform, friendId: string): boolean {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return false
    return this.cached(platform, revision).bypassIds.has(friendId)
  }

  /** Pick or unpick one or more friends in one write. */
  set(
    platform: Platform,
    friendIds: unknown,
    picked: unknown,
    revision: AlertPicksRevision | undefined
  ): AlertPickWriteResult {
    const current = this.revisionFor(platform)
    if (current === undefined) return { ok: false, reason: 'not-authenticated' }
    if (!isValidRequest(friendIds, picked)) return { ok: false, reason: 'invalid' }
    if (!sameRevision(revision, current)) return { ok: false, reason: 'stale' }

    const cached = this.cached(platform, current)
    const ids = applyPicks(cached.ids, friendIds, picked)
    if (sameIds(cached.ids, ids)) return { ok: true }
    if (ids.size > ALERT_PICKS_MAX) return { ok: false, reason: 'full' }

    const failure = this.persist(platform, current, ids)
    if (failure !== null) return { ok: false, reason: failure }
    cached.ids = ids
    return { ok: true }
  }

  /** Turn one alert type or Do not disturb bypass on or off for these friends. */
  setFriendAlert(
    platform: Platform,
    friendIds: unknown,
    change: unknown,
    revision: AlertPicksRevision | undefined
  ): AlertPickWriteResult {
    const current = this.revisionFor(platform)
    if (current === undefined) return { ok: false, reason: 'not-authenticated' }
    if (!isFriendIdList(friendIds) || !isFriendAlertChange(change)) {
      return { ok: false, reason: 'invalid' }
    }
    if (!sameRevision(revision, current)) return { ok: false, reason: 'stale' }

    const cached = this.cached(platform, current)
    if (change.kind === 'bypass')
      return this.writeBypass(platform, current, cached, friendIds, change.enabled)
    return this.writeType(platform, current, cached, friendIds, change.type, change.enabled)
  }

  /** Writes the picks, keeping the namespace's other fields. */
  private persist(
    platform: Platform,
    current: AlertPicksRevision,
    ids: ReadonlySet<string>
  ): 'stale' | 'invalid' | null {
    const prefs: SocialPrefsData =
      this.socialStore.read(platform, current.platformAccountId, 'socialPrefs')?.data ?? {}
    try {
      this.socialStore.write(
        { platform, platformAccountId: current.platformAccountId, epoch: current.epoch },
        'socialPrefs',
        { ...prefs, followedFriendIds: [...ids] }
      )
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return message.includes('stale account epoch') ? 'stale' : 'invalid'
    }
  }

  private revisionFor(platform: Platform): AlertPicksRevision | undefined {
    const resolution = this.accountSession.resolve(platform)
    if ('status' in resolution) return undefined
    const platformAccountId = this.accountSession.getAccountId(platform)
    if (platformAccountId === null) return undefined
    return { platformAccountId, epoch: resolution.epoch }
  }

  private writeBypass(
    platform: Platform,
    current: AlertPicksRevision,
    cached: CachedPicks,
    friendIds: readonly string[],
    enabled: boolean
  ): AlertPickWriteResult {
    const next = new Set(cached.bypassIds)
    let changed = false
    for (const friendId of friendIds) {
      if (enabled && !next.has(friendId)) {
        next.add(friendId)
        changed = true
      } else if (!enabled && next.has(friendId)) {
        next.delete(friendId)
        changed = true
      }
    }
    if (!changed) return { ok: true }
    if (next.size > ALERT_PICKS_MAX) return { ok: false, reason: 'full' }
    const data: DoNotDisturbBypassData = {}
    for (const friendId of next) data[friendId] = true
    const failure = this.writeNamespace(platform, current, 'doNotDisturbBypass', data)
    if (failure !== null) return { ok: false, reason: failure }
    cached.bypassIds = next
    return { ok: true }
  }

  private writeType(
    platform: Platform,
    current: AlertPicksRevision,
    cached: CachedPicks,
    friendIds: readonly string[],
    type: FriendAlertKind,
    enabled: boolean
  ): AlertPickWriteResult {
    const next = new Map(cached.optOuts)
    let changed = false
    for (const friendId of friendIds) {
      const types = new Set(next.get(friendId) ?? [])
      const had = types.has(type)
      if (enabled && had) types.delete(type)
      else if (!enabled && !had) types.add(type)
      else continue
      changed = true
      if (types.size === 0) next.delete(friendId)
      else next.set(friendId, types)
    }
    if (!changed) return { ok: true }
    if (next.size > PER_FRIEND_OPT_OUTS_MAX) return { ok: false, reason: 'full' }
    const data: PerFriendOptOutsData = {}
    for (const [friendId, types] of next) {
      const stored = storedTypes(types)
      if (stored.length > 0) data[friendId] = stored
    }
    const failure = this.writeNamespace(platform, current, 'perFriendOptOuts', data)
    if (failure !== null) return { ok: false, reason: failure }
    cached.optOuts = next
    return { ok: true }
  }

  private writeNamespace(
    platform: Platform,
    current: AlertPicksRevision,
    namespace: 'perFriendOptOuts' | 'doNotDisturbBypass',
    data: PerFriendOptOutsData | DoNotDisturbBypassData
  ): 'stale' | 'invalid' | null {
    try {
      this.socialStore.write(
        { platform, platformAccountId: current.platformAccountId, epoch: current.epoch },
        namespace,
        data
      )
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return message.includes('stale account epoch') ? 'stale' : 'invalid'
    }
  }

  private cached(platform: Platform, revision: AlertPicksRevision): CachedPicks {
    const accountKey = `${platform}:${revision.platformAccountId}`
    const cached = this.cache.get(platform)
    if (cached && cached.accountKey === accountKey && cached.epoch === revision.epoch) {
      return cached
    }
    const account = revision.platformAccountId
    const prefs = this.socialStore.read(platform, account, 'socialPrefs')
    const bypass = this.socialStore.read(platform, account, 'doNotDisturbBypass')
    const opted = this.socialStore.read(platform, account, 'perFriendOptOuts')
    const optOuts = new Map<string, Set<string>>()
    for (const [friendId, types] of Object.entries(opted?.data ?? {})) {
      if (!isValidAlertFriendId(friendId)) continue
      optOuts.set(friendId, new Set(types))
    }
    const next: CachedPicks = {
      accountKey,
      epoch: revision.epoch,
      ids: new Set((prefs?.data?.followedFriendIds ?? []).filter(isValidAlertFriendId)),
      bypassIds: new Set(Object.keys(bypass?.data ?? {}).filter(isValidAlertFriendId)),
      optOuts
    }
    this.cache.set(platform, next)
    return next
  }
}

function storedTypes(types: ReadonlySet<string>): PerFriendOptOutsData[string] {
  return [...types].filter((type): type is PerFriendOptOutsData[string][number] =>
    STORED_ALERT_TYPES.has(type)
  )
}
