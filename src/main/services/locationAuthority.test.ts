import { describe, expect, it, vi } from 'vitest'
import type { CvrFriend, Friend, Platform, VrcFriend } from '@shared/types'
import { LocationAuthority } from './locationAuthority'

function friend(platform: 'vrchat', id: string, instanceId?: string): VrcFriend
function friend(platform: 'chilloutvr', id: string, instanceId?: string): CvrFriend
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
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const revision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1')], revision)

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
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const revision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1')], revision)
    authority.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('vrchat', 'usr_1', 'instance-new')
    })

    const resolved = authority.resolve('vrchat', 'usr_1')
    expect(resolved.ok && resolved.friend.instance?.instanceId).toBe('instance-new')
  })

  it.each(['ask-me', 'dnd'] as const)(
    'merges a %s profile update while preserving cached presence, instance, and local fields',
    (status) => {
      const authority = new LocationAuthority()
      authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
      const cached = friend('vrchat', 'usr_1', 'instance-live')
      cached.isFavorite = true
      cached.favoriteGroupIds = ['group_1']
      cached.linkedPersonId = 'person_1'
      const revision = authority.captureSeedRevision('vrchat')
      authority.seed('vrchat', [cached], revision)

      authority.consume({
        type: 'friend-updated',
        platform: 'vrchat',
        friend: {
          ...friend('vrchat', 'usr_1', 'instance-untrusted'),
          displayName: 'Updated Friend',
          presence: { state: 'offline' },
          instance: null,
          status
        }
      })

      const resolved = authority.resolve('vrchat', 'usr_1')
      expect(resolved).toMatchObject({
        ok: true,
        friend: {
          displayName: 'Updated Friend',
          status,
          isFavorite: true,
          favoriteGroupIds: ['group_1'],
          linkedPersonId: 'person_1'
        }
      })
      expect(resolved.ok && resolved.friend.presence).toBe(cached.presence)
      expect(resolved.ok && resolved.friend.instance).toBe(cached.instance)
    }
  )

  it('ignores profile updates for an unseeded platform and an unknown friend', () => {
    const authority = new LocationAuthority()
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const unseededRevision = authority.captureSeedRevision('vrchat')
    authority.consume({
      type: 'friend-updated',
      platform: 'vrchat',
      friend: { ...friend('vrchat', 'usr_unseeded'), status: 'ask-me' }
    })
    authority.seed('vrchat', [], unseededRevision)
    expect(authority.resolve('vrchat', 'usr_unseeded')).toEqual({
      ok: false,
      reason: 'unknown-friend'
    })

    authority.consume({
      type: 'friend-updated',
      platform: 'vrchat',
      friend: { ...friend('vrchat', 'usr_unknown'), status: 'dnd' }
    })
    expect(authority.resolve('vrchat', 'usr_unknown')).toEqual({
      ok: false,
      reason: 'unknown-friend'
    })
  })

  it('revision-fences profile updates between older and newer seeds', () => {
    const authority = new LocationAuthority()
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const initialRevision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1')], initialRevision)

    const olderSeedRevision = authority.captureSeedRevision('vrchat')
    authority.consume({
      type: 'friend-updated',
      platform: 'vrchat',
      friend: { ...friend('vrchat', 'usr_1'), displayName: 'Live Update', status: 'ask-me' }
    })
    authority.seed(
      'vrchat',
      [{ ...friend('vrchat', 'usr_1'), displayName: 'Older Seed', status: 'online' }],
      olderSeedRevision
    )
    expect(authority.resolve('vrchat', 'usr_1')).toMatchObject({
      ok: true,
      friend: { displayName: 'Live Update', status: 'ask-me' }
    })

    const newerSeedRevision = authority.captureSeedRevision('vrchat')
    authority.seed(
      'vrchat',
      [{ ...friend('vrchat', 'usr_1'), displayName: 'Newer Seed', status: 'online' }],
      newerSeedRevision
    )
    expect(authority.resolve('vrchat', 'usr_1')).toMatchObject({
      ok: true,
      friend: { displayName: 'Newer Seed', status: 'online' }
    })
  })

  it('never lets an older seed clobber a newer delta or re-add a removed friend', () => {
    const authority = new LocationAuthority()
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
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

    const first = authority.resolve('vrchat', 'usr_1')
    expect(first.ok && first.friend.instance?.instanceId).toBe('instance-new')
    expect(authority.resolve('vrchat', 'usr_2')).toEqual({ ok: false, reason: 'unknown-friend' })
  })

  it('merges an id-only CVR presence delta that arrives before its roster seed', () => {
    const authority = new LocationAuthority()
    authority.consume({ type: 'connection', platform: 'chilloutvr', health: 'live' })
    const seedRevision = authority.captureSeedRevision('chilloutvr')
    const live = friend('chilloutvr', 'cvr_1', 'i+live-instance').instance!
    authority.consume({
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [{ platformUserId: 'cvr_1', presence: { state: 'in-game' }, instance: live }]
    })
    authority.seed('chilloutvr', [friend('chilloutvr', 'cvr_1', 'i+stale-roster')], seedRevision)

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

  it('remains stale after reconnecting live until a post-transition seed lands', () => {
    const authority = new LocationAuthority()
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const seedARevision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1', 'instance-a')], seedARevision)

    authority.consume({ type: 'connection', platform: 'vrchat', health: 'down' })
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    expect(authority.resolve('vrchat', 'usr_1')).toEqual({ ok: false, reason: 'stale' })

    const seedBRevision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1', 'instance-b')], seedBRevision)
    const resolved = authority.resolve('vrchat', 'usr_1')
    expect(resolved.ok && resolved.friend.instance?.instanceId).toBe('instance-b')
  })

  it('rejects a seed captured before the live transition even when it lands afterward', () => {
    const authority = new LocationAuthority()
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    const initialRevision = authority.captureSeedRevision('vrchat')
    authority.seed('vrchat', [friend('vrchat', 'usr_1', 'instance-a')], initialRevision)

    authority.consume({ type: 'connection', platform: 'vrchat', health: 'down' })
    const preLiveRevision = authority.captureSeedRevision('vrchat')
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    authority.seed('vrchat', [friend('vrchat', 'usr_1', 'instance-pre-live')], preLiveRevision)

    expect(authority.resolve('vrchat', 'usr_1')).toEqual({ ok: false, reason: 'stale' })
  })

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
