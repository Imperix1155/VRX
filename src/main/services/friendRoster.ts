import type { Friend, Platform } from '@shared/types'
import type { FriendRoster, IPlatformAdapter } from './adapters/IPlatformAdapter'
import type { AppStatusService } from './appStatus'
import type { LocationAuthority } from './locationAuthority'

/** One roster read, with the seed revision captured before it. */
export interface FriendRosterRead {
  roster: FriendRoster
  revision: number
}

/**
 * The roster read behind `get-friends`. Main also runs it after a reconnect
 * while no window is open (`RosterCatchUp`). In order: capture a location
 * authority seed revision, read through the adapter (concurrent reads share one
 * run), seed the authority from each physical read, record the reconcile time,
 * then hand `onRoster` the authority's merged rows.
 */
export function createFriendRosterReader(
  adapters: ReadonlyMap<Platform, IPlatformAdapter>,
  authority: LocationAuthority,
  appStatus: AppStatusService,
  onRoster?: (platform: Platform, friends: Friend[]) => void
): (platform: Platform) => Promise<FriendRosterRead> {
  return async (platform) => {
    const adapter = adapters.get(platform)
    if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`)
    const revision = authority.captureSeedRevision(platform)
    const roster = await adapter.getFriends()
    if (roster.seeds) {
      for (const seed of roster.seeds) {
        authority.seed(platform, seed.friends, seed.revision, seed.completeness)
      }
    } else {
      authority.seed(platform, roster.friends, revision, roster.completeness)
    }
    appStatus.recordReconcile(platform)
    try {
      // Hand on the authority's merged view, not the raw rows: a live removal
      // or move that landed while this read was in flight must win over it.
      if (onRoster) {
        const accepted = roster.friends.flatMap((friend) => {
          const resolved = authority.resolve(platform, friend.platformUserId)
          return resolved.ok ? [resolved.friend] : []
        })
        onRoster(platform, accepted)
      }
    } catch {
      /* A consumer failure must not fail the roster read. */
    }
    return { roster, revision }
  }
}
