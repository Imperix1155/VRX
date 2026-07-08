import { describe, expect, it } from 'vitest'
import { parseCvrPrivacy } from './parseCvrPrivacy'

const RESTRICTED = { type: 'owner-must-invite', openness: 'invite', isGroup: false }

describe('parseCvrPrivacy (VRX-147)', () => {
  it.each([
    ['Public', 'public', 'public', false],
    ['FriendsOfFriends', 'friends-of-friends', 'friends-plus', false],
    ['Friends', 'friends', 'friends', false],
    ['EveryoneCanInvite', 'everyone-can-invite', 'invite-plus', false],
    ['OwnerMustInvite', 'owner-must-invite', 'invite', false],
    // Group-family: openness normalizes into the friend ladder (like VRChat's
    // opennessFor: group → invite); isGroup carries the §6 chip modifier.
    ['GroupsOnly', 'members-only', 'invite', true]
  ])('maps the verified wire value %s', (wire, type, openness, isGroup) => {
    expect(parseCvrPrivacy(wire)).toEqual({ type, openness, isGroup })
  })

  it('is case- and punctuation-insensitive (wire casing drift)', () => {
    expect(parseCvrPrivacy('friends_of_friends').type).toBe('friends-of-friends')
    expect(parseCvrPrivacy('PUBLIC').type).toBe('public')
  })

  it('keeps digits significant — "Friends2" must NOT alias to friends (no access overstatement)', () => {
    expect(parseCvrPrivacy('Friends2')).toEqual(RESTRICTED)
  })

  it('degrades unknown/missing values to the MOST RESTRICTIVE access (api-volatility convention)', () => {
    expect(parseCvrPrivacy('SomeFutureValue')).toEqual(RESTRICTED)
    expect(parseCvrPrivacy(null)).toEqual(RESTRICTED)
    expect(parseCvrPrivacy(undefined)).toEqual(RESTRICTED)
  })

  // The LIVE wire (WS ONLINE_FRIENDS + /1/instances) sends privacy as an INTEGER
  // enum, not a string. Values 0–6 from the owner's prior app; 7 captured live
  // 2026-07-08 on a KNOWN group instance (owner ground truth).
  describe('numeric enum (live wire)', () => {
    it.each([
      [0, 'public', 'public', false], // live-confirmed
      [1, 'friends', 'friends', false], // reference (1|2=friends)
      [2, 'friends', 'friends', false], // live-confirmed
      [3, 'members-only', 'invite', true], // reference (3|6=group)
      [4, 'owner-must-invite', 'invite', false], // reference (4|5=private)
      [5, 'owner-must-invite', 'invite', false], // reference
      [6, 'members-only', 'invite', true], // reference
      [7, 'members-only', 'invite', true] // live-confirmed (newer than prior app)
    ])('maps privacy integer %i', (wire, type, openness, isGroup) => {
      expect(parseCvrPrivacy(wire)).toEqual({ type, openness, isGroup })
    })

    it('degrades an unknown integer to the MOST RESTRICTIVE access', () => {
      expect(parseCvrPrivacy(99)).toEqual(RESTRICTED)
      expect(parseCvrPrivacy(-1)).toEqual(RESTRICTED)
    })
  })
})
