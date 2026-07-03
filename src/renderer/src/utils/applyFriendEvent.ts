/**
 * Pure cache-application for live adapter events (VRX-146).
 *
 * Takes the current cached friend list and one AdapterEvent, returns the next
 * list (a NEW array when anything changed — TanStack Query relies on reference
 * inequality to notify subscribers; unchanged entries keep their references so
 * React.memo rows skip re-rendering).
 *
 * Semantics per event (mirrors the AdapterEvent contract in @shared/types):
 * - friend-presence: full upsert — the event carries fresh presence + instance.
 * - friend-offline:  patch the cached entry to offline (state only; profile
 *   fields kept); unknown ids are ignored (the reconcile will catch up).
 * - friend-updated:  merge PROFILE fields only; the cached presence + instance
 *   are preserved (the wire event says nothing about either).
 * - friend-added:    upsert. friend-removed: filter out.
 * - friends-snapshot scope 'all': full replacement. scope 'online' (CVR
 *   semantics, VRX-147): every cached friend NOT in the snapshot flips offline,
 *   snapshot members are upserted.
 * - connection: no list change (handled by the hook — reconcile trigger).
 */
import type { AdapterEvent, Friend } from '@shared/types'

function upsert(friends: Friend[], incoming: Friend): Friend[] {
  const index = friends.findIndex(
    (f) => f.platform === incoming.platform && f.platformUserId === incoming.platformUserId
  )
  if (index === -1) return [...friends, incoming]
  const next = friends.slice()
  next[index] = incoming
  return next
}

export function applyFriendEvent(friends: Friend[], event: AdapterEvent): Friend[] {
  switch (event.type) {
    case 'friend-presence':
    case 'friend-added':
      return upsert(friends, event.friend)

    case 'friend-offline':
      return friends.map((f): Friend =>
        f.platform === event.platform && f.platformUserId === event.platformUserId
          ? {
              ...f,
              presence: { state: 'offline' },
              // Offline friends carry no status pill or instance (§5 axes).
              status: null,
              statusDescription: null,
              instance: null
            }
          : f
      )

    case 'friend-updated':
      return friends.map((f): Friend =>
        f.platform === event.platform && f.platformUserId === event.friend.platformUserId
          ? ({
              ...event.friend,
              // The wire event says nothing about presence/location — keep ours.
              presence: f.presence,
              instance: f.instance,
              // isFavorite/groups are local-ish state the WS never carries.
              isFavorite: f.isFavorite,
              favoriteGroupIds: f.favoriteGroupIds,
              linkedPersonId: f.linkedPersonId
            } as Friend)
          : f
      )

    case 'friend-removed':
      return friends.filter(
        (f) => !(f.platform === event.platform && f.platformUserId === event.platformUserId)
      )

    case 'friends-snapshot': {
      if (event.scope === 'all') return event.friends
      // scope 'online': snapshot members upsert; absent members are offline.
      const present = new Set(event.friends.map((f) => f.platformUserId))
      let next = friends.map((f): Friend =>
        f.platform === event.platform && !present.has(f.platformUserId)
          ? {
              ...f,
              presence: { state: 'offline' },
              status: null,
              statusDescription: null,
              instance: null
            }
          : f
      )
      for (const friend of event.friends) next = upsert(next, friend)
      return next
    }

    case 'connection':
      return friends
  }
}
