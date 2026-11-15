/**
 * The friends list's own history (owner, 2026-11-15): a new friend, someone
 * no longer on the list, a friend's new name. VRCX keeps the same record.
 *
 * It asks no platform for anything. It compares each friends list VRX already
 * reads with the one it saw before, and listens to the live events VRX already
 * receives. Neither platform says when a friendship began, so "friends since"
 * is the day VRX saw it begin; everyone already on the list when history
 * starts is only known to have been a friend since before that day.
 *
 * A friend counts as gone only after two complete lists in a row without
 * them, or when the platform's own live event says so. A partial list never
 * removes anyone.
 */
import type { FriendHistoryFacts, FriendListKind } from '@shared/activity'
import type { AdapterEvent, Friend, Platform } from '@shared/types'
import type { RosterCompleteness } from './adapters/IPlatformAdapter'
import type { SavedFriend, SavedNameChange } from './historyDatabase'

/** Complete lists in a row a friend must be missing from before they count as gone. */
const MISSES_BEFORE_REMOVED = 2
/** Previous names shown for one friend. */
export const FRIEND_PREVIOUS_NAMES_MAX = 20

export interface FriendListChange {
  kind: FriendListKind
  platform: Platform
  platformUserId: string
  /** Their name now (for `removed`, the last one known). */
  displayName: string
  /** `renamed` only. */
  previousName?: string
}

/** The saved copy, for the account signed in right now on that platform. */
export interface FriendLogStore {
  /** The saved friends list, or null when nothing is being saved. */
  load(platform: Platform): SavedFriend[] | null
  save(platform: Platform, friends: readonly SavedFriend[]): void
  remove(platform: Platform, platformUserId: string): void
  nameChanged(platform: Platform, platformUserId: string, previousName: string, at: number): void
  friend(platform: Platform, platformUserId: string): SavedFriend | null
  names(platform: Platform, platformUserId: string, limit: number): SavedNameChange[]
  clearAll(): void
}

export interface FriendLogOptions {
  now: () => number
  /** Read at each decision: whether the user keeps activity at all. */
  isEnabled: () => boolean
  /** A change to show in the Activity list. */
  record: (change: FriendListChange) => void
  store?: FriendLogStore
}

interface PlatformState {
  /** Whether a first list has been taken as the starting point. */
  started: boolean
  friends: Map<string, SavedFriend>
}

export class FriendLog {
  private readonly states = new Map<Platform, PlatformState>()

  constructor(private readonly options: FriendLogOptions) {}

  /** A friends list was read. `friends` is the whole list when `complete`. */
  rosterRead(
    platform: Platform,
    friends: readonly Friend[],
    completeness: RosterCompleteness
  ): void {
    if (!this.options.isEnabled()) return
    const state = this.state(platform)
    const complete = completeness === 'complete'
    if (!state.started) {
      // The starting point must be a whole list, or later lists would report
      // everyone it missed as new.
      if (!complete || friends.length === 0) return
      const now = this.options.now()
      const first: SavedFriend[] = []
      for (const friend of friends) {
        if (!isUsable(friend)) continue
        const saved: SavedFriend = {
          platformUserId: friend.platformUserId,
          displayName: friend.displayName,
          since: now,
          sinceKnown: false,
          misses: 0
        }
        state.friends.set(friend.platformUserId, saved)
        first.push(saved)
      }
      state.started = true
      this.options.store?.save(platform, first)
      return
    }

    const present = new Set<string>()
    for (const friend of friends) {
      if (!isUsable(friend)) continue
      present.add(friend.platformUserId)
      this.seen(platform, state, friend)
    }
    if (!complete || present.size === 0) return
    const missed: SavedFriend[] = []
    for (const known of [...state.friends.values()]) {
      if (present.has(known.platformUserId)) continue
      known.misses += 1
      if (known.misses >= MISSES_BEFORE_REMOVED) this.gone(platform, state, known.platformUserId)
      else missed.push(known)
    }
    // Saved, so a friend removed while VRX was closed is still noticed: the
    // second list without them can be the next launch's.
    if (missed.length > 0) this.options.store?.save(platform, missed)
  }

  /** Live events VRX already receives. */
  consume(event: AdapterEvent): void {
    if (!this.options.isEnabled()) return
    switch (event.type) {
      // Presence events are left alone: some carry an id and no name.
      case 'friend-added':
      case 'friend-updated': {
        const state = this.state(event.platform)
        // Before the starting point, a new friend is part of it.
        if (!state.started || !isUsable(event.friend)) return
        // Only the platform's own "new friend" event adds someone: a profile
        // change for a person the list has not shown yet proves nothing.
        if (event.type !== 'friend-added' && !state.friends.has(event.friend.platformUserId)) return
        this.seen(event.platform, state, event.friend)
        return
      }
      case 'friend-removed': {
        const state = this.state(event.platform)
        if (state.started) this.gone(event.platform, state, event.platformUserId)
        return
      }
      default:
        return
    }
  }

  /** What is saved about one friendship. */
  facts(platform: Platform, friendId: string): FriendHistoryFacts {
    const store = this.options.store
    const known =
      this.states.get(platform)?.friends.get(friendId) ?? store?.friend(platform, friendId)
    const names = store?.names(platform, friendId, FRIEND_PREVIOUS_NAMES_MAX) ?? []
    return {
      platform,
      friendId,
      since: known?.since ?? null,
      sinceKnown: known?.sinceKnown ?? false,
      previousNames: names.map((change) => ({ name: change.previousName, until: change.at }))
    }
  }

  /** An account boundary: the next list belongs to whoever signs in. */
  resetPlatform(platform: Platform): void {
    this.states.delete(platform)
  }

  /** Saving was just turned on: save the lists known now. */
  saveAll(): void {
    const store = this.options.store
    if (store === undefined) return
    for (const [platform, state] of this.states) {
      if (!state.started) continue
      store.save(platform, [...state.friends.values()])
    }
  }

  /** The user turned activity off: forget everything, saved history included. */
  clearAll(): void {
    this.states.clear()
    this.options.store?.clearAll()
  }

  /** A friend is on the list: new, renamed, or as before. */
  private seen(platform: Platform, state: PlatformState, friend: Friend): void {
    const known = state.friends.get(friend.platformUserId)
    if (known === undefined) {
      const saved: SavedFriend = {
        platformUserId: friend.platformUserId,
        displayName: friend.displayName,
        since: this.options.now(),
        sinceKnown: true,
        misses: 0
      }
      state.friends.set(friend.platformUserId, saved)
      this.options.store?.save(platform, [saved])
      this.options.record({
        kind: 'added',
        platform,
        platformUserId: friend.platformUserId,
        displayName: friend.displayName
      })
      return
    }
    const wasMissed = known.misses > 0
    known.misses = 0
    if (known.displayName === friend.displayName) {
      if (wasMissed) this.options.store?.save(platform, [known])
      return
    }
    const previousName = known.displayName
    known.displayName = friend.displayName
    this.options.store?.save(platform, [known])
    // A saved row with no name yet just takes the name; nothing changed.
    if (previousName.trim() === '') return
    this.options.store?.nameChanged(
      platform,
      friend.platformUserId,
      previousName,
      this.options.now()
    )
    this.options.record({
      kind: 'renamed',
      platform,
      platformUserId: friend.platformUserId,
      displayName: friend.displayName,
      previousName
    })
  }

  private gone(platform: Platform, state: PlatformState, platformUserId: string): void {
    const known = state.friends.get(platformUserId)
    if (known === undefined) return
    state.friends.delete(platformUserId)
    this.options.store?.remove(platform, platformUserId)
    this.options.record({
      kind: 'removed',
      platform,
      platformUserId,
      displayName: known.displayName
    })
  }

  /** This platform's list, loaded from the saved copy the first time. */
  private state(platform: Platform): PlatformState {
    let state = this.states.get(platform)
    if (state === undefined) {
      state = { started: false, friends: new Map() }
      this.states.set(platform, state)
    }
    // Until a starting point exists, look again: the saved copy only answers
    // once the account is known.
    if (!state.started) {
      const saved = this.options.store?.load(platform) ?? []
      if (saved.length > 0) {
        state.started = true
        for (const friend of saved) state.friends.set(friend.platformUserId, { ...friend })
      }
    }
    return state
  }
}

/** A friend with an id and a real name. A row without a name is skipped, so a
 *  list that has not resolved names yet never reads as a rename. */
function isUsable(friend: Friend): boolean {
  return friend.platformUserId !== '' && friend.displayName.trim() !== ''
}
