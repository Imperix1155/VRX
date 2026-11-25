import type { OwnProfile, OwnProfileChanges, OwnStatus } from '@shared/ownProfile'

/**
 * The signed-in VRChat status used to mute alerts. Every read, save, and live
 * update goes through here. A partial update that does not name a status
 * cannot replace or clear the one already held. Only a session boundary clears it.
 */
export class OwnAlertStatus {
  private status: OwnStatus | null = null
  private generation = 0

  current(): OwnStatus | null {
    return this.status
  }

  /** Captured when a profile read or save starts, so a later live update wins. */
  revision(): number {
    return this.generation
  }

  clear(): void {
    this.status = null
    this.generation += 1
  }

  /** A live status word from a reply or `user-update`. */
  observe(status: OwnStatus): void {
    this.adopt(status)
  }

  observeProfile(update: {
    profile: OwnProfile
    /** Set on a save: only these fields were written. Absent on a read. */
    changes?: OwnProfileChanges
    asOf: number
  }): void {
    if (update.profile.platform !== 'vrchat') return
    if (update.changes) {
      if (update.changes.status === undefined) return
      this.adopt(update.changes.status)
      return
    }
    if (update.profile.status === null) return
    if (update.asOf !== this.generation) return
    this.adopt(update.profile.status)
  }

  private adopt(status: OwnStatus): void {
    this.generation += 1
    this.status = status
  }
}
