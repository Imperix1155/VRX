import { describe, expect, it } from 'vitest'
import { hotInstanceKey } from './hotInstanceKey'

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
