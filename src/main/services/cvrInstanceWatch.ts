/**
 * ChilloutVR's side of the instance log (owner, 2026-11-15). ChilloutVR keeps
 * no join and leave list VRX may read, so this listens to what VRX already
 * receives and asks for nothing more:
 *
 * - the live connection's presence list says which room the signed-in user is
 *   in, and which friends are in the same room (their coming and going is
 *   exact);
 * - the one instance read VRX already makes for that room lists who was there
 *   when it was read (everyone else: seen from the user's arrival until the
 *   user leaves).
 *
 * VRChat's side reads the game's own log instead (`vrchatGameLog.ts`).
 */
import type { AdapterEvent } from '@shared/types'

export interface CvrInstanceWatchSink {
  enter(
    platform: 'chilloutvr',
    room: { instanceId: string; worldName: string | null; at: number }
  ): void
  nameWorld(platform: 'chilloutvr', worldName: string): void
  join(
    platform: 'chilloutvr',
    person: { platformUserId: string; displayName: string; at: number }
  ): void
  leave(platform: 'chilloutvr', platformUserId: string, at: number): void
  exit(platform: 'chilloutvr', at: number): void
}

export interface CvrInstanceWatchOptions {
  /** Read at each list: whether an instance log is kept at all. */
  isEnabled: () => boolean
  /** The ChilloutVR account signed in to VRX, or null. */
  ownId: () => string | null
  /** Who was in an instance, from the read VRX already made; never a request. */
  members: (instanceId: string) => Array<{ platformUserId: string; displayName: string }> | null
  /** A friend's name from the friends list VRX already holds. */
  nameOf: (platformUserId: string) => string | null
  sink: CvrInstanceWatchSink
  now: () => number
}

export class CvrInstanceWatch {
  private instanceId: string | null = null
  private enteredAt = 0
  private worldNamed = false
  private membersTaken = false
  /** Everyone recorded as present in this visit. */
  private readonly here = new Set<string>()
  /** The friends among them, whose leaving the live connection reports. */
  private readonly friendsHere = new Set<string>()

  constructor(private readonly options: CvrInstanceWatchOptions) {}

  consume(event: AdapterEvent): void {
    if (event.type !== 'presence-snapshot' || event.platform !== 'chilloutvr') return
    if (!this.options.isEnabled()) {
      // Start over once it is kept again: the next list opens the room anew.
      this.forget()
      return
    }
    const ownId = this.options.ownId()?.toLowerCase() ?? null
    if (ownId === null) return
    const now = this.options.now()
    const own = event.entries.find((entry) => entry.platformUserId.toLowerCase() === ownId)
    const instance = own?.instance ?? null
    if (instance === null) {
      // Offline, in no room, or the platform does not list the user.
      if (this.instanceId !== null) {
        this.options.sink.exit('chilloutvr', now)
        this.forget()
      }
      return
    }
    // Until the instance read answers, the world id is the instance id and
    // the name is only the instance's label.
    const worldName = instance.worldId === instance.instanceId ? null : instance.worldName
    if (instance.instanceId !== this.instanceId) {
      this.forget()
      this.instanceId = instance.instanceId
      this.enteredAt = now
      this.worldNamed = worldName !== null
      this.options.sink.enter('chilloutvr', {
        instanceId: instance.instanceId,
        worldName,
        at: now
      })
    } else if (!this.worldNamed && worldName !== null) {
      this.worldNamed = true
      this.options.sink.nameWorld('chilloutvr', worldName)
    }

    if (!this.membersTaken) {
      const members = this.options.members(instance.instanceId)
      if (members !== null) {
        this.membersTaken = true
        for (const member of members) {
          if (member.platformUserId === ownId || this.here.has(member.platformUserId)) continue
          this.here.add(member.platformUserId)
          // Already there when the user arrived, as far as anyone can tell.
          this.options.sink.join('chilloutvr', { ...member, at: this.enteredAt })
        }
      }
    }

    const friendsNow = new Set<string>()
    for (const entry of event.entries) {
      if (entry.platformUserId.toLowerCase() === ownId) continue
      if (entry.instance?.instanceId === instance.instanceId) friendsNow.add(entry.platformUserId)
    }
    for (const id of friendsNow) {
      if (this.friendsHere.has(id)) continue
      if (!this.here.has(id)) {
        // No name yet: wait for the friends list rather than save a blank.
        const displayName = this.options.nameOf(id)
        if (displayName === null || displayName.trim() === '') continue
        this.here.add(id)
        this.options.sink.join('chilloutvr', { platformUserId: id, displayName, at: now })
      }
      this.friendsHere.add(id)
    }
    for (const id of [...this.friendsHere]) {
      if (friendsNow.has(id)) continue
      this.friendsHere.delete(id)
      this.here.delete(id)
      this.options.sink.leave('chilloutvr', id, now)
    }
  }

  /** An account boundary: the next list belongs to whoever signs in. */
  resetPlatform(): void {
    this.forget()
  }

  private forget(): void {
    this.instanceId = null
    this.enteredAt = 0
    this.worldNamed = false
    this.membersTaken = false
    this.here.clear()
    this.friendsHere.clear()
  }
}
