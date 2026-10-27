import type { Platform } from '@shared/types'
import type { AccountSession } from './accountSession'
import { FAVORITES_MAX, type SocialPrefsData, type SocialStore } from './socialStore'

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
  ids: ReadonlySet<string>
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

function isValidRequest(friendIds: unknown, picked: unknown): friendIds is string[] {
  return (
    Array.isArray(friendIds) &&
    friendIds.length > 0 &&
    friendIds.length <= ALERT_PICKS_MAX &&
    friendIds.every(isValidAlertFriendId) &&
    typeof picked === 'boolean'
  )
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
 * The friends each signed-in account picked for alerts. Stored locally in the
 * account's SocialStore `socialPrefs.followedFriendIds`; nothing is sent to a
 * platform. Reads are cached per account and epoch because the alert engine
 * asks on every friend transition.
 */
export class FriendAlertPicks {
  private readonly cache = new Map<Platform, CachedPicks>()

  constructor(
    private readonly accountSession: AccountSession,
    private readonly socialStore: SocialStore
  ) {}

  /** The current account's picks, or none with no revision while signed out. */
  list(platform: Platform): { friendIds: string[]; revision?: AlertPicksRevision } {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return { friendIds: [] }
    return { friendIds: [...this.idsFor(platform, revision)], revision }
  }

  /** Whether the current account picked this friend. Signed out is never picked. */
  isPicked(platform: Platform, friendId: string): boolean {
    const revision = this.revisionFor(platform)
    if (revision === undefined) return false
    return this.idsFor(platform, revision).has(friendId)
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

    const before = this.idsFor(platform, current)
    const ids = applyPicks(before, friendIds, picked)
    if (sameIds(before, ids)) return { ok: true }
    if (ids.size > ALERT_PICKS_MAX) return { ok: false, reason: 'full' }

    const failure = this.persist(platform, current, ids)
    if (failure !== null) return { ok: false, reason: failure }
    this.cache.set(platform, {
      accountKey: `${platform}:${current.platformAccountId}`,
      epoch: current.epoch,
      ids
    })
    return { ok: true }
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

  private idsFor(platform: Platform, revision: AlertPicksRevision): ReadonlySet<string> {
    const accountKey = `${platform}:${revision.platformAccountId}`
    const cached = this.cache.get(platform)
    if (cached && cached.accountKey === accountKey && cached.epoch === revision.epoch) {
      return cached.ids
    }
    const stored = this.socialStore.read(platform, revision.platformAccountId, 'socialPrefs')
    const ids = new Set((stored?.data?.followedFriendIds ?? []).filter(isValidAlertFriendId))
    this.cache.set(platform, { accountKey, epoch: revision.epoch, ids })
    return ids
  }
}
