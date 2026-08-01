import { describe, expect, it } from 'vitest'
import {
  hotInstanceKey,
  isHotInstanceMember,
  isWorldHidden,
  type HotMembershipView
} from './hotInstanceKey'

describe('hotInstanceKey (VRX-237)', () => {
  it('returns null without an instance id (not in a visible instance)', () => {
    expect(hotInstanceKey('vrchat', null, 'wrld_1')).toBeNull()
    expect(hotInstanceKey('chilloutvr', null, null)).toBeNull()
  })

  it('keys VRChat by [worldId, instanceId] — the suffix is unique only inside a world', () => {
    expect(hotInstanceKey('vrchat', '12345~public', 'wrld_a')).toBe('wrld_a\u000012345~public')
    // Same instance suffix in a different world is a DIFFERENT instance.
    expect(hotInstanceKey('vrchat', '12345~public', 'wrld_a')).not.toBe(
      hotInstanceKey('vrchat', '12345~public', 'wrld_b')
    )
    // A missing world id degrades to the empty world segment, never a throw.
    expect(hotInstanceKey('vrchat', '12345~public', null)).toBe('\u000012345~public')
  })

  it('keys CVR by the globally unique instance id alone (stable across world-metadata enrichment)', () => {
    expect(hotInstanceKey('chilloutvr', 'instance-guid', null)).toBe('instance-guid')
    // The same CVR instance keeps ONE key while its worldId resolves async.
    expect(hotInstanceKey('chilloutvr', 'instance-guid', 'instance-guid')).toBe(
      hotInstanceKey('chilloutvr', 'instance-guid', 'world-guid')
    )
  })

  it('treats different instance ids in the SAME world as different instances (the VRX-237 law)', () => {
    const a = hotInstanceKey('vrchat', 'wrld_1:aaa~public', 'wrld_1')
    const b = hotInstanceKey('vrchat', 'wrld_1:bbb~public', 'wrld_1')
    expect(a).not.toBe(b)
  })
})

// ─── Membership predicate (VRX-237 — one law for toast + cards) ─────────────

describe('isHotInstanceMember / isWorldHidden (VRX-237)', () => {
  const view = (overrides: Partial<HotMembershipView> = {}): HotMembershipView => ({
    platform: 'vrchat',
    presence: { state: 'in-game' },
    status: 'online',
    instance: { instanceId: 'wrld_1:12345~public' },
    ...overrides
  })

  it('includes a visible in-game friend', () => {
    expect(isHotInstanceMember(view())).toBe(true)
    expect(isHotInstanceMember(view({ status: 'join-me' }))).toBe(true)
  })

  it('excludes in-game VRChat Ask Me / DND — hidden-location is invisible to the hot system', () => {
    expect(isHotInstanceMember(view({ status: 'ask-me' }))).toBe(false)
    expect(isHotInstanceMember(view({ status: 'dnd' }))).toBe(false)
    expect(isWorldHidden(view({ status: 'ask-me' }))).toBe(true)
    expect(isWorldHidden(view({ status: 'dnd' }))).toBe(true)
  })

  it('excludes by STATE with a retained hidden status (offline / active)', () => {
    expect(isHotInstanceMember(view({ status: 'dnd', presence: { state: 'offline' } }))).toBe(false)
    expect(isHotInstanceMember(view({ status: 'ask-me', presence: { state: 'active' } }))).toBe(
      false
    )
    // …and an offline friend with a retained status is not "hidden" either —
    // there is no world to hide (VRX-69 nuance, preserved in the move).
    expect(isWorldHidden(view({ status: 'dnd', presence: { state: 'offline' } }))).toBe(false)
  })

  it('excludes a null instance', () => {
    expect(isHotInstanceMember(view({ instance: null }))).toBe(false)
  })

  it('CVR has no status axis — an in-game CVR friend is a visible member', () => {
    const cvr = view({ platform: 'chilloutvr', status: null, instance: { instanceId: 'i+abc' } })
    expect(isHotInstanceMember(cvr)).toBe(true)
    expect(isWorldHidden(cvr)).toBe(false)
    // CVR still needs the state + instance arms.
    expect(isHotInstanceMember(view({ platform: 'chilloutvr', status: null }))).toBe(true)
    expect(
      isHotInstanceMember(
        view({ platform: 'chilloutvr', status: null, presence: { state: 'offline' } })
      )
    ).toBe(false)
  })
})
