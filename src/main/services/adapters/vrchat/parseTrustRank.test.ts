import { describe, it, expect } from 'vitest'
import { parseTrustRank } from './parseTrustRank'

describe('parseTrustRank', () => {
  describe('empty and null inputs', () => {
    it('returns visitor for an empty array', () => {
      expect(parseTrustRank([])).toBe('visitor')
    })

    it('returns visitor when no trust tags are present', () => {
      expect(parseTrustRank(['some_other_tag', 'unrelated'])).toBe('visitor')
    })
  })

  describe('single trust tags (basic mapping)', () => {
    it('maps system_trust_basic to new', () => {
      expect(parseTrustRank(['system_trust_basic'])).toBe('new')
    })

    it('maps system_trust_known to user', () => {
      expect(parseTrustRank(['system_trust_known'])).toBe('user')
    })

    it('maps system_trust_trusted to known', () => {
      expect(parseTrustRank(['system_trust_trusted'])).toBe('known')
    })

    it('maps system_trust_veteran to trusted', () => {
      expect(parseTrustRank(['system_trust_veteran'])).toBe('trusted')
    })
  })

  describe('nuisance tag (separate, overrides hierarchy)', () => {
    it('maps system_probable_troll to nuisance', () => {
      expect(parseTrustRank(['system_probable_troll'])).toBe('nuisance')
    })

    it('returns nuisance even when other trust tags are present', () => {
      expect(parseTrustRank(['system_trust_veteran', 'system_probable_troll'])).toBe('nuisance')
    })

    it('returns nuisance with mixed irrelevant tags', () => {
      expect(parseTrustRank(['some_tag', 'system_probable_troll', 'another_tag'])).toBe('nuisance')
    })
  })

  describe('multiple trust tags (highest wins)', () => {
    it('returns highest when basic and known are both present', () => {
      expect(parseTrustRank(['system_trust_basic', 'system_trust_known'])).toBe('user')
    })

    it('returns highest when known and trusted are both present', () => {
      expect(parseTrustRank(['system_trust_known', 'system_trust_trusted'])).toBe('known')
    })

    it('returns highest when all tags are present (veteran wins)', () => {
      expect(
        parseTrustRank([
          'system_trust_basic',
          'system_trust_known',
          'system_trust_trusted',
          'system_trust_veteran'
        ])
      ).toBe('trusted')
    })

    it('returns veteran (highest) even when listed first', () => {
      expect(parseTrustRank(['system_trust_veteran', 'system_trust_basic'])).toBe('trusted')
    })

    it('ignores unknown tags and uses the highest trust tag', () => {
      expect(parseTrustRank(['unknown_tag', 'system_trust_known', 'another_unknown'])).toBe('user')
    })
  })

  describe('mixed irrelevant and trust tags', () => {
    it('ignores platform tags and uses trust rank', () => {
      expect(
        parseTrustRank(['platformUser', 'system_trust_trusted', 'incomingFriendRequest'])
      ).toBe('known')
    })

    it('ignores status tags', () => {
      expect(parseTrustRank(['online', 'system_trust_basic', 'in_world'])).toBe('new')
    })

    it('works with many irrelevant tags', () => {
      expect(parseTrustRank(['tag1', 'tag2', 'system_trust_known', 'tag3', 'tag4', 'tag5'])).toBe(
        'user'
      )
    })
  })

  describe('edge cases and type safety', () => {
    it('handles repeated trust tags by returning the highest', () => {
      expect(parseTrustRank(['system_trust_known', 'system_trust_known'])).toBe('user')
    })

    it('handles case sensitivity (tags must match exactly)', () => {
      expect(parseTrustRank(['System_Trust_Known', 'SYSTEM_TRUST_KNOWN'])).toBe('visitor')
    })

    it('returns visitor for an array of empty strings', () => {
      expect(parseTrustRank(['', '', ''])).toBe('visitor')
    })

    it('handles tags with trailing/leading spaces as distinct', () => {
      // VRChat should not send these, but defensive handling
      expect(parseTrustRank([' system_trust_known', 'system_trust_known '])).toBe('visitor')
    })
  })

  describe('defensive parsing (unknown enum values degrade gracefully)', () => {
    it('ignores hypothetical future trust tags', () => {
      expect(parseTrustRank(['system_trust_future_rank', 'system_trust_known'])).toBe('user')
    })

    it('ignores completely unknown tags', () => {
      expect(parseTrustRank(['system_xyz_unknown'])).toBe('visitor')
    })

    it('ignores malformed tag names', () => {
      expect(parseTrustRank(['system-trust-known', 'system.trust.known'])).toBe('visitor')
    })
  })
})
