import { describe, expect, it } from 'vitest'
import type { VrcCurrentUserBuckets, VrcRawFriend } from './parsePresence'
import { parsePresence } from './parsePresence'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USR_A = 'usr_aaaaaaaa-0000-0000-0000-000000000001'
const USR_B = 'usr_bbbbbbbb-0000-0000-0000-000000000002'

const baseFriend = (id: string, overrides?: Partial<VrcRawFriend>): VrcRawFriend => ({
  id,
  status: 'active',
  statusDescription: null,
  ...overrides
})

const baseBuckets = (overrides?: Partial<VrcCurrentUserBuckets>): VrcCurrentUserBuckets => ({
  onlineFriends: [],
  activeFriends: [],
  offlineFriends: [],
  ...overrides
})

// ─── State derivation (from buckets, not from a friend field) ─────────────────

describe('parsePresence — state axis', () => {
  it('returns "in-game" when friend id is in onlineFriends', () => {
    const result = parsePresence(baseFriend(USR_A), baseBuckets({ onlineFriends: [USR_A] }))
    expect(result.state).toBe('in-game')
  })

  it('returns "active" when friend id is in activeFriends', () => {
    const result = parsePresence(baseFriend(USR_A), baseBuckets({ activeFriends: [USR_A] }))
    expect(result.state).toBe('active')
  })

  it('returns "offline" when friend id is in offlineFriends', () => {
    const result = parsePresence(baseFriend(USR_A), baseBuckets({ offlineFriends: [USR_A] }))
    expect(result.state).toBe('offline')
  })

  it('returns "offline" when friend id is absent from all buckets', () => {
    const result = parsePresence(baseFriend(USR_A), baseBuckets())
    expect(result.state).toBe('offline')
  })

  it('does not confuse onlineFriends with another id', () => {
    // USR_B is online; USR_A is not in any bucket → 'offline'
    const result = parsePresence(baseFriend(USR_A), baseBuckets({ onlineFriends: [USR_B] }))
    expect(result.state).toBe('offline')
  })

  it('prefers onlineFriends over activeFriends when both list the id (defensive)', () => {
    // Duplicate in two buckets should not crash; onlineFriends checked first.
    const result = parsePresence(
      baseFriend(USR_A),
      baseBuckets({ onlineFriends: [USR_A], activeFriends: [USR_A] })
    )
    expect(result.state).toBe('in-game')
  })
})

// ─── Status mapping (from friend.status string, independent of state) ─────────

describe('parsePresence — status axis', () => {
  it('maps "join me" → "join-me"', () => {
    const result = parsePresence(baseFriend(USR_A, { status: 'join me' }), baseBuckets())
    expect(result.status).toBe('join-me')
  })

  it('maps "active" → "online"  (NOT confused with PresenceState "active")', () => {
    const result = parsePresence(baseFriend(USR_A, { status: 'active' }), baseBuckets())
    expect(result.status).toBe('online')
  })

  it('maps "ask me" → "ask-me"', () => {
    const result = parsePresence(baseFriend(USR_A, { status: 'ask me' }), baseBuckets())
    expect(result.status).toBe('ask-me')
  })

  it('maps "busy" → "dnd"', () => {
    const result = parsePresence(baseFriend(USR_A, { status: 'busy' }), baseBuckets())
    expect(result.status).toBe('dnd')
  })

  it('maps "offline" → null', () => {
    const result = parsePresence(baseFriend(USR_A, { status: 'offline' }), baseBuckets())
    expect(result.status).toBeNull()
  })

  it('maps null status → null', () => {
    const result = parsePresence(baseFriend(USR_A, { status: null }), baseBuckets())
    expect(result.status).toBeNull()
  })

  it('maps undefined status → null', () => {
    const result = parsePresence(baseFriend(USR_A, { status: undefined }), baseBuckets())
    expect(result.status).toBeNull()
  })

  it('maps unknown status string → "online" (degrades gracefully, never throws)', () => {
    expect(() =>
      parsePresence(baseFriend(USR_A, { status: 'some-future-status' }), baseBuckets())
    ).not.toThrow()
    const result = parsePresence(baseFriend(USR_A, { status: 'some-future-status' }), baseBuckets())
    expect(result.status).toBe('online')
  })
})

// ─── statusDescription pass-through ──────────────────────────────────────────

describe('parsePresence — statusDescription', () => {
  it('passes through a non-null statusDescription', () => {
    const result = parsePresence(
      baseFriend(USR_A, { statusDescription: 'Having fun!' }),
      baseBuckets()
    )
    expect(result.statusDescription).toBe('Having fun!')
  })

  it('returns null for a null statusDescription', () => {
    const result = parsePresence(baseFriend(USR_A, { statusDescription: null }), baseBuckets())
    expect(result.statusDescription).toBeNull()
  })

  it('coerces undefined statusDescription to null', () => {
    const result = parsePresence(baseFriend(USR_A, { statusDescription: undefined }), baseBuckets())
    expect(result.statusDescription).toBeNull()
  })
})

// ─── Integration: two axes are independent ───────────────────────────────────

describe('parsePresence — axes are independent', () => {
  it('state=in-game does not force status away from null', () => {
    const result = parsePresence(
      baseFriend(USR_A, { status: 'offline' }),
      baseBuckets({ onlineFriends: [USR_A] })
    )
    expect(result.state).toBe('in-game')
    expect(result.status).toBeNull()
  })

  it('status=null does not force state to offline', () => {
    const result = parsePresence(
      baseFriend(USR_A, { status: null }),
      baseBuckets({ activeFriends: [USR_A] })
    )
    expect(result.state).toBe('active')
    expect(result.status).toBeNull()
  })
})
