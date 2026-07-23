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
 * - friends-snapshot scope 'all': full replacement; scope 'online': absentees
 *   flip offline, members upsert (currently producer-less — CVR moved to
 *   presence-snapshot when the wire turned out to carry no profiles).
 * - presence-snapshot (the CVR contract, VRX-147): patch presence+instance by
 *   id — no profiles on the wire; absent same-platform friends flip offline.
 * - connection: no list change (handled by the hook — reconcile trigger).
 */
import type { AdapterEvent, Friend } from '@shared/types'

/** Value-compare ALL InstanceInfo fields (snapshot entries are freshly allocated). */
function sameInstance(a: Friend['instance'], b: Friend['instance']): boolean {
  if (a === null || b === null) return a === b
  return (
    a.worldId === b.worldId &&
    a.instanceId === b.instanceId &&
    a.worldName === b.worldName &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.type === b.type &&
    a.openness === b.openness &&
    a.isGroup === b.isGroup &&
    a.groupName === b.groupName &&
    a.region === b.region &&
    a.userCount === b.userCount
  )
}

function upsert(
  friends: Friend[],
  incoming: Friend,
  preserve?: { presence?: boolean; instance?: boolean }
): Friend[] {
  const index = friends.findIndex(
    (f) => f.platform === incoming.platform && f.platformUserId === incoming.platformUserId
  )
  if (index === -1) return [...friends, incoming]
  const cached = friends[index]!
  const next = friends.slice()
  // Cast is safe: `cached` and `incoming` share the same platform (the match
  // gates on it), so spreading the same-platform incoming friend and re-taking
  // cached fields yields a valid Friend of that same variant — TS just can't
  // re-narrow the discriminated union across the spread.
  next[index] = {
    ...incoming,
    // Local-ish state the WS never carries — preserve across every replacing path.
    isFavorite: cached.isFavorite,
    favoriteGroupIds: cached.favoriteGroupIds,
    linkedPersonId: cached.linkedPersonId,
    ...(preserve?.presence ? { presence: cached.presence } : {}),
    ...(preserve?.instance ? { instance: cached.instance } : {})
  } as Friend
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
      // Profile-only change: the wire says nothing about presence/location, so
      // preserve those along with the local-ish state now handled inside upsert().
      return upsert(friends, event.friend, { presence: true, instance: true })

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

    case 'presence-snapshot': {
      // CVR ONLINE_FRIENDS (VRX-147): the wire carries ids + instances, no
      // profiles — patch presence/instance for listed ids on the CACHED
      // entries; absent same-platform friends are offline (the CVR contract).
      // Unknown ids are ignored — the roster refetch carries the profile.
      // CVR re-pushes the FULL set on every change, so a no-op entry must keep
      // its reference (the header's identity invariant; memo'd rows skip) —
      // wire instances arrive freshly allocated, so compare by value.
      const byId = new Map(event.entries.map((e) => [e.platformUserId, e]))
      let changed = false
      const next = friends.map((f): Friend => {
        if (f.platform !== event.platform) return f
        const entry = byId.get(f.platformUserId)
        if (entry === undefined) {
          if (f.presence.state === 'offline') return f
          changed = true
          return {
            ...f,
            presence: { state: 'offline' },
            status: null,
            statusDescription: null,
            instance: null
          }
        }
        if (f.presence.state === entry.presence.state && sameInstance(f.instance, entry.instance)) {
          return f
        }
        changed = true
        return { ...f, presence: entry.presence, instance: entry.instance } as Friend
      })
      return changed ? next : friends
    }

    case 'roster-changed':
      // Trigger-only: the hook invalidates the friends query (REST refetch).
      return friends

    case 'auth-invalidated':
      // Trigger-only: the hook invalidates that platform's auth query (VRX-195).
      return friends

    case 'connection':
      return friends
  }
}
