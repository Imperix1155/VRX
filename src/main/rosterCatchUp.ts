import type { AdapterEvent, Platform } from '@shared/types'

export interface RosterCatchUpOptions {
  /** Whether a window is open. Its renderer refetches friends on `live`. */
  hasWindow: () => boolean
  /** The `get-friends` roster read (`createFriendRosterReader`). */
  readRoster: (platform: Platform) => Promise<unknown>
  /** A catch-up read failed. Gets the platform only. */
  logFailure: (platform: Platform) => void
}

/**
 * The reconnect roster read while no window is open. On `live` the alerts and
 * the Activity list forget presence, and the one roster read after a reconnect
 * (api-policy.md) teaches them the roster again. An open window's friends
 * refetch is that read. macOS keeps VRX running after its window closes, and
 * then main runs it itself. With a window open this never reads.
 *
 * Like the renderer's quarantine, a platform whose session failed a check
 * (`auth-invalidated`) gets no read on `live`, since a socket can open before
 * the server turns a stale session away, until a roster read works again.
 */
export class RosterCatchUp {
  private readonly unproven = new Set<Platform>()

  constructor(private readonly options: RosterCatchUpOptions) {}

  consume(event: AdapterEvent): void {
    if (event.type === 'auth-invalidated') {
      this.unproven.add(event.platform)
      return
    }
    if (event.type !== 'connection' || event.health !== 'live') return
    if (this.unproven.has(event.platform) || this.options.hasWindow()) return
    const platform = event.platform
    this.options.readRoster(platform).catch(() => {
      try {
        this.options.logFailure(platform)
      } catch {
        /* Nothing left to report with. */
      }
    })
  }

  /** A roster read for this platform worked, from any caller. */
  rosterRead(platform: Platform): void {
    this.unproven.delete(platform)
  }
}
