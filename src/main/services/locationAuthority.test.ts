import { describe, expect, it, vi } from 'vitest'
import type { Friend, Platform } from '@shared/types'
import { LocationAuthority } from './locationAuthority'

function friend(platform: Platform, id: string, instanceId = 'instance-old'): Friend {
  const common = {
    platform,
    platformUserId: id,
    displayName: id,
    avatarUrl: null,
    presence: { state: 'in-game' as const },
    instance: {
      worldId: platform === 'vrchat' ? 'wrld_example' : instanceId,
      instanceId,
      worldName: null,
      thumbnailUrl: null,
      type: 'friends' as const,
      openness: 'friends' as const,
      isGroup: false,
      groupName: null,
      region: null,
      userCount: null
    },
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
  return platform === 'vrchat'
    ? { ...common, platform, status: 'online', statusDescription: null, trustRank: null }
    : { ...common, platform, status: null, statusDescription: null, trustRank: null }
}

describe('LocationAuthority', () => {
  it('rejects before the first seed and while the pipeline is stale', () => {
    const authority = new LocationAuthority()
    expect(authority.resolve('vrchat', 'usr_1')).toEqual({ ok: false, reason: 'stale' })

    const revision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1')], revision)
    expect(authority.resolve('vrchat', 'usr_1')).toEqual({ ok: false, reason: 'stale' })
  })

  it('resolves only after a successful seed and live connection', () => {
    const authority = new LocationAuthority()
    const revision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1')], revision)
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })

    expect(authority.resolve('vrchat', 'usr_1')).toMatchObject({
      ok: true,
      friend: { platformUserId: 'usr_1' }
    })
    expect(authority.resolve('vrchat', 'usr_missing')).toEqual({
      ok: false,
      reason: 'unknown-friend'
    })
  })

  it('applies live deltas synchronously', () => {
    const authority = new LocationAuthority()
    const revision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1')], revision)
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    authority.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('vrchat', 'usr_1', 'instance-new')
    })

    const resolved = authority.resolve('vrchat', 'usr_1')
    expect(resolved.ok && resolved.friend.instance?.instanceId).toBe('instance-new')
  })

  it('never lets an older seed clobber a newer delta or re-add a removed friend', () => {
    const authority = new LocationAuthority()
    const oldSeed = authority.captureSeedRevision('vrchat')
    authority.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('vrchat', 'usr_1', 'instance-new')
    })
    authority.consume({ type: 'friend-removed', platform: 'vrchat', platformUserId: 'usr_2' })
    authority.seed(
      'vrchat',
      [friend('vrchat', 'usr_1', 'instance-old'), friend('vrchat', 'usr_2')],
      oldSeed
    )
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })

    const first = authority.resolve('vrchat', 'usr_1')
    expect(first.ok && first.friend.instance?.instanceId).toBe('instance-new')
    expect(authority.resolve('vrchat', 'usr_2')).toEqual({ ok: false, reason: 'unknown-friend' })
  })

  it('merges an id-only CVR presence delta that arrives before its roster seed', () => {
    const authority = new LocationAuthority()
    const seedRevision = authority.captureSeedRevision('chilloutvr')
    const live = friend('chilloutvr', 'cvr_1', 'i+live-instance').instance!
    authority.consume({
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [{ platformUserId: 'cvr_1', presence: { state: 'in-game' }, instance: live }]
    })
    authority.seed('chilloutvr', [friend('chilloutvr', 'cvr_1', 'i+stale-roster')], seedRevision)
    authority.consume({ type: 'connection', platform: 'chilloutvr', health: 'live' })

    const resolved = authority.resolve('chilloutvr', 'cvr_1')
    expect(resolved.ok && resolved.friend.instance?.instanceId).toBe('i+live-instance')
  })

  it.each(['reconnecting', 'down', 'degraded', 'failed'] as const)(
    'gates joins when connection health becomes %s',
    (health) => {
      const authority = new LocationAuthority()
      const revision = authority.captureSeedRevision('chilloutvr')
      authority.seed('chilloutvr', [friend('chilloutvr', 'cvr_1')], revision)
      authority.consume({ type: 'connection', platform: 'chilloutvr', health: 'live' })
      authority.consume({ type: 'connection', platform: 'chilloutvr', health })
      expect(authority.resolve('chilloutvr', 'cvr_1')).toEqual({ ok: false, reason: 'stale' })
    }
  )

  it('clears one platform at a session boundary and uses injected clock/log', () => {
    const log = vi.fn()
    const authority = new LocationAuthority({ clock: () => 42, log })
    const revision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1')], revision)
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    authority.clearPlatform('vrchat')

    expect(authority.resolve('vrchat', 'usr_1')).toEqual({ ok: false, reason: 'stale' })
    expect(log).toHaveBeenCalledWith('debug', 'location authority cleared', {
      platform: 'vrchat',
      at: 42
    })
  })

  it('drops a seed captured before a session-boundary clear', () => {
    const authority = new LocationAuthority()
    const oldRevision = authority.captureSeedRevision('vrchat')
    authority.clearPlatform('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_old_account')], oldRevision)
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })

    expect(authority.resolve('vrchat', 'usr_old_account')).toEqual({
      ok: false,
      reason: 'stale'
    })
  })
})
