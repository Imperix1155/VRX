import { describe, expect, it } from 'vitest'
import type { InstanceInfo, Platform } from '@shared/types'
import { policySpaceFor, type PolicySpace } from './instancePolicySpace'

interface PolicyCase {
  platform: Platform
  type: InstanceInfo['type']
  expected: PolicySpace
}

describe('policy-space classification', () => {
  it.each<PolicyCase>([
    { platform: 'vrchat', type: 'public', expected: 'public' },
    { platform: 'vrchat', type: 'group-public', expected: 'public' },
    { platform: 'vrchat', type: 'friends-plus', expected: 'private' },
    { platform: 'vrchat', type: 'friends', expected: 'private' },
    { platform: 'vrchat', type: 'invite-plus', expected: 'private' },
    { platform: 'vrchat', type: 'invite', expected: 'private' },
    { platform: 'vrchat', type: 'group-plus', expected: 'private' },
    { platform: 'vrchat', type: 'group', expected: 'private' },
    { platform: 'chilloutvr', type: 'public', expected: 'public' },
    { platform: 'chilloutvr', type: 'group-public', expected: 'public' },
    { platform: 'chilloutvr', type: 'friends-of-friends', expected: 'public' },
    { platform: 'chilloutvr', type: 'friends-of-members', expected: 'public' },
    { platform: 'chilloutvr', type: 'friends', expected: 'private' },
    { platform: 'chilloutvr', type: 'everyone-can-invite', expected: 'private' },
    { platform: 'chilloutvr', type: 'owner-must-invite', expected: 'private' },
    { platform: 'chilloutvr', type: 'members-only', expected: 'unknown' },
    { platform: 'chilloutvr', type: 'offline', expected: 'unknown' }
  ])('$platform $type → $expected', ({ platform, type, expected }) => {
    expect(policySpaceFor(platform, { type })).toBe(expected)
  })

  it('opennessUnknown overrides every recognized type', () => {
    expect(policySpaceFor('vrchat', { type: 'public', opennessUnknown: true })).toBe('unknown')
    expect(
      policySpaceFor('chilloutvr', {
        type: 'friends-of-friends',
        opennessUnknown: true
      })
    ).toBe('unknown')
  })

  it('an impossible platform/type pairing never becomes a confident policy claim', () => {
    expect(policySpaceFor('chilloutvr', { type: 'invite' })).toBe('unknown')
  })
})
