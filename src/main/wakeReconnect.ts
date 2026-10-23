/**
 * After sleep a live socket can look open while its connection is gone,
 * freezing presence with no error. Ask each platform to redial once instead.
 * A screen unlock alone keeps the network up, so it doesn't count: each
 * redial costs a roster read. Resumes within `WAKE_RECONNECT_COALESCE_MS`
 * count once.
 */

/** The slice of Electron's `powerMonitor` this module uses; tests fake it. */
export interface WakeEventSource {
  on(event: WakeEvent, listener: () => void): unknown
  removeListener(event: WakeEvent, listener: () => void): unknown
}

/** An adapter whose open live socket can be dropped and redialed. */
export interface LiveReconnectTarget {
  reconnectNow(): void
}

type WakeEvent = 'resume'

const WAKE_EVENTS: readonly WakeEvent[] = ['resume']

export const WAKE_RECONNECT_COALESCE_MS = 60_000

export function reconnectLiveOnWake(
  source: WakeEventSource,
  targets: readonly LiveReconnectTarget[],
  options: { now?: () => number; logFailure?: () => void } = {}
): () => void {
  const now = options.now ?? Date.now
  let lastWakeAt: number | null = null
  const onWake = (): void => {
    const at = now()
    if (lastWakeAt !== null && Math.abs(at - lastWakeAt) < WAKE_RECONNECT_COALESCE_MS) return
    lastWakeAt = at
    for (const target of targets) {
      try {
        target.reconnectNow()
      } catch {
        // One platform failing must not keep the other on a dead socket.
        options.logFailure?.()
      }
    }
  }
  for (const event of WAKE_EVENTS) source.on(event, onWake)
  return () => {
    for (const event of WAKE_EVENTS) source.removeListener(event, onWake)
  }
}
