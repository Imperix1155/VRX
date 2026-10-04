import type { QueryClient } from '@tanstack/react-query'
import { MAX_FRIENDS } from '@shared/constants'
import type { AdapterEvent, Friend } from '@shared/types'
import { applyFriendEvent } from '../utils/applyFriendEvent'

type LiveDelta = Extract<
  AdapterEvent,
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

interface Replay {
  events: LiveDelta[]
  overflow: () => void
}

// Only active VRChat roster attempts retain events, scoped to their query client.
// One roster-sized burst is ample headroom without an unbounded event history.
const activeReplays = new WeakMap<QueryClient, Set<Replay>>()
export class FriendEventReplayOverflowError extends Error {
  constructor() {
    super('Friends changed too often during refresh')
    this.name = 'FriendEventReplayOverflowError'
  }
}

/** Called by the existing app-wide subscription, after its auth quarantine guard. */
export function recordFriendEventForReplay(client: QueryClient, event: AdapterEvent): void {
  if (
    event.platform !== 'vrchat' ||
    event.type === 'connection' ||
    event.type === 'auth-invalidated' ||
    event.type === 'roster-changed' ||
    event.type === 'presence-snapshot' ||
    event.type === 'friends-snapshot'
  )
    return
  for (const replay of activeReplays.get(client) ?? []) {
    if (replay.events.length === MAX_FRIENDS) replay.overflow()
    else replay.events.push(event)
  }
}

/**
 * Protect one roster from deltas received after its request starts. Keep the
 * journal until Query publishes success, including the promise-to-cache gap.
 * Cancellation (including account boundaries) releases it immediately. CVR's
 * full presence snapshots keep their existing separately owned replay path.
 */
export async function withFriendEventReplay(
  client: QueryClient,
  signal: AbortSignal,
  load: () => Promise<Friend[]>
): Promise<Friend[]> {
  let rejectOverflow!: (error: Error) => void
  const overflow = new Promise<never>((_resolve, reject) => {
    rejectOverflow = reject
  })
  const replays = activeReplays.get(client) ?? new Set<Replay>()
  activeReplays.set(client, replays)
  const replay: Replay = {
    events: [],
    overflow: () => {
      dispose()
      // Reject rather than cancel/revert: retain live cached data, and let a
      // first load enter an error state instead of staying pending.
      rejectOverflow(new FriendEventReplayOverflowError())
    }
  }
  let disposed = false
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return
    const key = event.query.queryKey as readonly unknown[]
    if (key.length !== 2 || key[0] !== 'friends' || key[1] !== 'vrchat') return
    if (event.action.type !== 'success' || event.action.manual) return
    const events = replay.events
    dispose()
    if (events.length === 0) return
    client.setQueryData<Friend[]>(key, (roster) =>
      roster === undefined ? undefined : events.reduce(applyFriendEvent, roster)
    )
  })
  function dispose(): void {
    if (disposed) return
    disposed = true
    replay.events = []
    replays.delete(replay)
    if (replays.size === 0) activeReplays.delete(client)
    unsubscribe()
    signal.removeEventListener('abort', dispose)
  }
  replays.add(replay)
  signal.addEventListener('abort', dispose, { once: true })
  try {
    signal.throwIfAborted()
    return await Promise.race([load(), overflow])
  } catch (error) {
    dispose()
    throw error
  }
}
