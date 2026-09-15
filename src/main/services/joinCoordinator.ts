import type { Platform } from '@shared/types'

export interface JoinPermit {
  complete(): void
  release(): void
}

/** One platform launch at a time, with shared destination and existing friend cooldowns. */
export class JoinCoordinator {
  private readonly active = new Set<Platform>()
  private readonly completed = new Map<string, number>()

  constructor(private readonly clock: () => number = () => performance.now()) {}

  acquire(platform: Platform, destinationKey: string, friendId?: string): JoinPermit | null {
    const now = this.clock()
    for (const [key, time] of this.completed) {
      if (now - time >= 3_000) this.completed.delete(key)
    }
    const keys = [`destination:${platform}:${destinationKey}`]
    if (friendId !== undefined) keys.push(`friend:${platform}:${friendId}`)
    if (this.active.has(platform) || keys.some((key) => this.completed.has(key))) return null
    this.active.add(platform)
    let released = false
    return {
      complete: () => {
        if (!released) for (const key of keys) this.completed.set(key, this.clock())
      },
      release: () => {
        if (!released) this.active.delete(platform)
        released = true
      }
    }
  }
}
