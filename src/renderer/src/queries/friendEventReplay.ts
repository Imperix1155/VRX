import { replaceEqualDeep, type QueryClient } from '@tanstack/react-query'
import { MAX_FRIENDS } from '@shared/constants'
import type { FriendEvent, FriendRosterProvenance, FriendRosterResponse } from '@shared/ipc'
import type { Friend } from '@shared/types'
import { applyFriendEvent } from '../utils/applyFriendEvent'

type LiveDelta = Extract<
  FriendEvent,
  {
    type:
      | 'friend-presence'
      | 'friend-offline'
      | 'friend-added'
      | 'friend-removed'
      | 'friend-updated'
      | 'world-metadata'
      | 'group-metadata'
  }
>

interface Transport {
  events: LiveDelta[]
  provenance?: FriendRosterProvenance
  promise: Promise<Friend[]>
  settled: boolean
  consumers: Set<() => void>
  failure?: Error
  reject: (error: unknown) => void
  dispose: () => void
}

// Renderer cancellation cannot cancel main's coalesced roster read. Replacement
// queries share this IPC operation and its journal until the transport settles.
const pending = new WeakMap<QueryClient, Transport>()
const journals = new WeakMap<QueryClient, Set<Transport>>()
const results = new WeakMap<object, Transport>()

export class FriendEventReplayOverflowError extends Error {
  constructor() {
    super('Friends changed too often during refresh')
    this.name = 'FriendEventReplayOverflowError'
  }
}

/** Called after auth quarantine; only active transports retain accepted deltas. */
export function recordFriendEventForReplay(client: QueryClient, event: FriendEvent): void {
  if (
    event.platform !== 'vrchat' ||
    event.type === 'connection' ||
    event.type === 'auth-invalidated' ||
    event.type === 'roster-changed' ||
    event.type === 'presence-snapshot' ||
    event.type === 'friends-snapshot'
  )
    return
  for (const transport of journals.get(client) ?? []) {
    if (transport.events.length < MAX_FRIENDS) transport.events.push(event)
    else {
      transport.failure = new FriendEventReplayOverflowError()
      transport.reject(transport.failure)
      transport.dispose()
      // Keep pending's failed tombstone until the underlying IPC settles. A
      // retry must not reopen the same main read with an empty journal.
    }
  }
}

/** Account boundaries abandon the transport; ordinary query cancellation does not. */
export function clearFriendEventReplay(client: QueryClient): void {
  pending.delete(client)
  for (const transport of journals.get(client) ?? []) {
    transport.failure = new Error('Friends account changed')
    transport.reject(transport.failure)
    transport.dispose()
  }
}

/** Query structural sharing runs before data reaches observers or cache subscribers. */
export function shareFriendReplayResult(previous: unknown, incoming: unknown): unknown {
  const transport = Array.isArray(incoming) ? results.get(incoming) : undefined
  if (!transport) return replaceEqualDeep(previous, incoming)
  results.delete(incoming as Friend[])
  const events = transport.events
  transport.dispose()
  if (transport.failure) throw transport.failure
  return replaceEqualDeep(
    previous,
    replayEvents(incoming as Friend[], events, transport.provenance)
  )
}

/** Compare each row with its physical read, not the containing IPC operation. */
function replayEvents(
  friends: Friend[],
  events: LiveDelta[],
  provenance?: FriendRosterProvenance
): Friend[] {
  const revisions = new Map<string, number>()
  for (const override of provenance?.overrides ?? []) {
    for (const id of override.friendIds) revisions.set(id, override.revision)
  }
  return events.reduce((current, event) => {
    const revision = event.rosterRevision
    if (revision === undefined || !provenance) return applyFriendEvent(current, event)
    const isNewer = (id: string): boolean =>
      revision > (revisions.get(id) ?? provenance.baseRevision)
    if (event.type === 'world-metadata' || event.type === 'group-metadata') {
      // One metadata event may affect rows from both physical reads.
      const changed = applyFriendEvent(
        current.filter((friend) => isNewer(friend.platformUserId)),
        event
      )
      const byId = new Map(changed.map((friend) => [friend.platformUserId, friend]))
      return current.map((friend) => byId.get(friend.platformUserId) ?? friend)
    }
    const id = 'friend' in event ? event.friend.platformUserId : event.platformUserId
    return isNewer(id) ? applyFriendEvent(current, event) : current
  }, friends)
}

export function withFriendEventReplay(
  client: QueryClient,
  signal: AbortSignal,
  load: () => Promise<Friend[] | FriendRosterResponse>
): Promise<Friend[]> {
  signal.throwIfAborted()
  let transport = pending.get(client)
  if (!transport) {
    let resolve!: (roster: Friend[]) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<Friend[]>((done, fail) => {
      resolve = done
      reject = fail
    })
    const active = journals.get(client) ?? new Set<Transport>()
    journals.set(client, active)
    const created: Transport = {
      events: [],
      promise,
      settled: false,
      consumers: new Set(),
      reject,
      dispose: () => {
        created.events = []
        active.delete(created)
        if (active.size === 0 && journals.get(client) === active) journals.delete(client)
        for (const stop of created.consumers) stop()
        created.consumers.clear()
      }
    }
    transport = created
    active.add(created)
    pending.set(client, created)
    void (async () => load())().then(
      (roster) => {
        created.settled = true
        if (pending.get(client) === created) pending.delete(client)
        if (created.failure) return
        // Unique identity associates only this transport's response with its
        // prepublication merge, even if a fixture/cache reuses the input array.
        created.provenance = Array.isArray(roster) ? undefined : roster.provenance
        const result = [...(Array.isArray(roster) ? roster : roster.friends)]
        results.set(result, created)
        if (created.consumers.size === 0) created.dispose()
        resolve(result)
      },
      (error: unknown) => {
        created.settled = true
        if (pending.get(client) === created) pending.delete(client)
        created.dispose()
        reject(error)
      }
    )
  }
  const owned = transport
  if (owned.failure) return owned.promise
  const onAbort = (): void => {
    stop()
    owned.consumers.delete(stop)
    if (owned.settled && owned.consumers.size === 0) owned.dispose()
  }
  const stop = (): void => signal.removeEventListener('abort', onAbort)
  owned.consumers.add(stop)
  signal.addEventListener('abort', onAbort, { once: true })
  return owned.promise
}
