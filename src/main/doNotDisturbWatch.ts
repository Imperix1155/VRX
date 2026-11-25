import {
  doNotDisturbAfterGames,
  isDoNotDisturbActive,
  type DoNotDisturbChoice
} from '@shared/doNotDisturb'
import type { Platform } from '@shared/types'

/** How often a mute that ends when a game starts looks at the process list. */
export const DO_NOT_DISTURB_GAME_POLL_MS = 5_000

/**
 * While Do not disturb is on and "end when a game starts" is on, watch the
 * local process list. The first look records games that are already open.
 */
export class DoNotDisturbGameWatch {
  private timer: ReturnType<typeof setTimeout> | null = null
  private seen: Set<Platform> | null = null
  private armed = false

  constructor(
    private readonly options: {
      choice: () => DoNotDisturbChoice
      until: () => number | null
      endOnGameStart: () => boolean
      now: () => number
      runningPlatforms: () => Promise<ReadonlySet<Platform> | null>
      end: () => void
      intervalMs?: number
    }
  ) {}

  /** Start or stop to match the current settings. Safe to call on every save. */
  sync(): void {
    if (!this.wanted()) {
      this.stop()
      return
    }
    if (this.armed) return
    this.armed = true
    this.seen = null
    void this.tick()
  }

  stop(): void {
    this.armed = false
    this.seen = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private wanted(): boolean {
    return (
      this.options.endOnGameStart() &&
      isDoNotDisturbActive(this.options.choice(), this.options.until(), this.options.now())
    )
  }

  private arm(): void {
    if (!this.armed || this.timer !== null) return
    const timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, this.options.intervalMs ?? DO_NOT_DISTURB_GAME_POLL_MS)
    timer.unref?.()
    this.timer = timer
  }

  private async tick(): Promise<void> {
    if (!this.armed) return
    if (!this.wanted()) {
      this.stop()
      return
    }
    let running: ReadonlySet<Platform> | null
    try {
      running = await this.options.runningPlatforms()
    } catch {
      running = null
    }
    if (!this.armed || !this.wanted()) {
      if (!this.wanted()) this.stop()
      return
    }
    const step = doNotDisturbAfterGames({
      active: true,
      endOnGameStart: true,
      seen: this.seen,
      running
    })
    if (step.action === 'end') {
      this.stop()
      this.options.end()
      return
    }
    if (step.action === 'baseline' || step.action === 'keep') this.seen = step.seen
    this.arm()
  }
}
