import { describe, expect, it } from 'vitest'
import { JoinCoordinator } from './joinCoordinator'
import { hotInstanceKey } from '@shared/hotInstanceKey'

describe('shared main Join coordinator', () => {
  it('blocks simultaneous friend and Explore launches on the same platform', () => {
    const joins = new JoinCoordinator(() => 0)
    const friend = joins.acquire('vrchat', 'world-a:room-a', 'friend-a')!
    expect(joins.acquire('vrchat', 'world-b:room-b')).toBeNull()
    expect(joins.acquire('chilloutvr', 'room-c')).not.toBeNull()
    friend.release()
    expect(joins.acquire('vrchat', 'world-b:room-b')).not.toBeNull()
  })

  it('shares successful destination cooldown across entry points without losing friend cooldown', () => {
    let now = 0
    const joins = new JoinCoordinator(() => now)
    const key = hotInstanceKey('vrchat', 'room-a', 'world-a')!
    const friend = joins.acquire('vrchat', key, 'friend-a')!
    friend.complete()
    friend.release()
    expect(joins.acquire('vrchat', key)).toBeNull()
    expect(joins.acquire('vrchat', key, 'friend-b')).toBeNull()
    expect(joins.acquire('vrchat', 'new-world:room-b', 'friend-a')).toBeNull()
    const different = joins.acquire('vrchat', 'new-world:room-b', 'friend-b')!
    different.release()
    now = 2_999
    expect(joins.acquire('vrchat', key)).toBeNull()
    now = 3_000
    expect(joins.acquire('vrchat', key)).not.toBeNull()
  })

  it('does not let failed or obsolete permits retain cooldown or release a newer owner', () => {
    const joins = new JoinCoordinator(() => 0)
    const failed = joins.acquire('vrchat', 'world:room')!
    failed.release()
    const next = joins.acquire('vrchat', 'world:room')!
    failed.complete()
    failed.release()
    expect(joins.acquire('vrchat', 'another:room')).toBeNull()
    next.release()
    expect(joins.acquire('vrchat', 'world:room')).not.toBeNull()
  })
})
