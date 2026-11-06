/**
 * The renderer's line for VRChat API-host pictures (owner, 2026-11-04: Groups
 * and Search pictures arrived one at a time, slowly, and some never did).
 *
 * Every `api.vrchat.cloud` picture costs one request in main's shared VRChat
 * queue, which starts at most one request per second. That limit stays. What
 * this line changes is which pictures use it:
 *
 *  - Pictures for tiles on screen now go first, in page order. A picture whose
 *    tile scrolled out of view waits, and one whose tile is gone (the user
 *    opened another page) is never asked for at all, so leftovers from the last
 *    page no longer hold up this one and no request is spent on them.
 *  - Only a few downloads are handed to main at a time; the rest wait here,
 *    where they can still be reordered or dropped.
 *
 * Pictures main already keeps on disk never wait in this line (`useAvatar`
 * asks for those first, without a download).
 */

/** Hosts whose pictures go through VRChat's shared request queue in main. */
export const API_IMAGE_HOSTS: ReadonlySet<string> = new Set(['api.vrchat.cloud'])

/**
 * Downloads handed to main at once. Main starts one API request per second, so
 * two keep that line busy without a gap while the rest stay here.
 */
export const API_IMAGE_MAX_IN_FLIGHT = 2

export function isApiImageUrl(url: string): boolean {
  try {
    return API_IMAGE_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Resolved for a download that was dropped because no tile wants it any more. */
export const DROPPED = Symbol('dropped')
export type QueuedResult = string | null | typeof DROPPED

interface Job {
  send: () => Promise<string | null>
  resolve: (result: QueuedResult) => void
}

export class ApiImageQueue {
  /** Who wants each picture: watcher id → whether its tile is near the screen. */
  private readonly watchers = new Map<string, Map<number, boolean>>()
  /** Waiting downloads in arrival order (Map keeps insertion order). */
  private readonly jobs = new Map<string, Job>()
  private inFlight = 0

  constructor(private readonly maxInFlight = API_IMAGE_MAX_IN_FLIGHT) {}

  get waiting(): number {
    return this.jobs.size
  }

  get running(): number {
    return this.inFlight
  }

  /** A tile showing `key` is near the screen (true) or scrolled away (false). */
  watch(key: string, watcher: number, visible: boolean): void {
    let byWatcher = this.watchers.get(key)
    if (byWatcher === undefined) {
      byWatcher = new Map()
      this.watchers.set(key, byWatcher)
    }
    byWatcher.set(watcher, visible)
    if (visible) this.pump()
  }

  /** The tile is gone. A waiting download nobody wants any more is dropped. */
  release(key: string, watcher: number): void {
    const byWatcher = this.watchers.get(key)
    if (byWatcher === undefined) return
    byWatcher.delete(watcher)
    if (byWatcher.size > 0) return
    this.watchers.delete(key)
    const job = this.jobs.get(key)
    if (job === undefined) return
    this.jobs.delete(key)
    job.resolve(DROPPED)
  }

  /**
   * Line up one download. A key already waiting shares that wait. A key with
   * no watcher at all is dropped at once: nothing would show it.
   */
  enqueue(key: string, send: () => Promise<string | null>): Promise<QueuedResult> {
    if (!this.watchers.has(key)) return Promise.resolve(DROPPED)
    return new Promise((resolve) => {
      this.jobs.set(key, { send, resolve })
      this.pump()
    })
  }

  private wanted(key: string): boolean {
    for (const visible of this.watchers.get(key)?.values() ?? []) if (visible) return true
    return false
  }

  private pump(): void {
    while (this.inFlight < this.maxInFlight) {
      let next: [string, Job] | undefined
      for (const entry of this.jobs) {
        if (this.wanted(entry[0])) {
          next = entry
          break
        }
      }
      if (next === undefined) return
      const [key, job] = next
      this.jobs.delete(key)
      this.inFlight += 1
      let sent: Promise<string | null>
      try {
        sent = job.send()
      } catch {
        sent = Promise.resolve(null)
      }
      void sent
        .catch(() => null)
        .then((result) => {
          this.inFlight -= 1
          job.resolve(result)
          this.pump()
        })
    }
  }
}

export const apiImageQueue = new ApiImageQueue()
