import { describe, expect, it } from 'vitest'
import { parseInstanceType } from './parseInstanceType'

describe('parseInstanceType', () => {
  // ── Public ──────────────────────────────────────────────────────────────────

  it('returns public for a bare instanceId with no access tags', () => {
    expect(parseInstanceType('wrld_abc:12345')).toBe('public')
  })

  it('returns public when the only tag is ~region', () => {
    expect(parseInstanceType('wrld_abc:12345~region(us)')).toBe('public')
  })

  it('returns public for an instanceId with no world prefix', () => {
    expect(parseInstanceType('12345')).toBe('public')
  })

  // ── Friends+ (~hidden) ───────────────────────────────────────────────────────

  it('returns friends-plus for ~hidden tag', () => {
    expect(parseInstanceType('wrld_abc:12345~hidden(usr_x)')).toBe('friends-plus')
  })

  it('returns friends-plus for ~hidden with region', () => {
    expect(parseInstanceType('wrld_abc:12345~region(eu)~hidden(usr_x)')).toBe('friends-plus')
  })

  // ── Friends (~friends) ───────────────────────────────────────────────────────

  it('returns friends for ~friends tag', () => {
    expect(parseInstanceType('wrld_abc:12345~friends(usr_x)')).toBe('friends')
  })

  // ── Invite (~private, no canRequestInvite) ───────────────────────────────────

  it('returns invite for ~private without ~canRequestInvite', () => {
    expect(parseInstanceType('wrld_abc:12345~private(usr_x)')).toBe('invite')
  })

  it('returns invite for ~private with unrelated extra tags', () => {
    expect(parseInstanceType('wrld_abc:12345~private(usr_x)~region(us)')).toBe('invite')
  })

  // ── Invite+ (~private + ~canRequestInvite) ───────────────────────────────────

  it('returns invite-plus for ~private + ~canRequestInvite', () => {
    expect(parseInstanceType('wrld_abc:12345~private(usr_x)~canRequestInvite')).toBe('invite-plus')
  })

  it('returns invite-plus with tags in reversed order', () => {
    expect(parseInstanceType('wrld_abc:12345~canRequestInvite~private(usr_x)')).toBe('invite-plus')
  })

  // ── Group Public ─────────────────────────────────────────────────────────────

  it('returns group-public for ~group + ~groupAccessType(public)', () => {
    expect(parseInstanceType('wrld_abc:12345~group(grp_x)~groupAccessType(public)')).toBe(
      'group-public'
    )
  })

  // ── Group+ ───────────────────────────────────────────────────────────────────

  it('returns group-plus for ~group + ~groupAccessType(plus)', () => {
    expect(parseInstanceType('wrld_abc:12345~group(grp_x)~groupAccessType(plus)')).toBe(
      'group-plus'
    )
  })

  // ── Group (members-only) ─────────────────────────────────────────────────────

  it('returns group for ~group + ~groupAccessType(members)', () => {
    expect(parseInstanceType('wrld_abc:12345~group(grp_x)~groupAccessType(members)')).toBe('group')
  })

  it('returns group (most-restrictive default) when ~group has no groupAccessType', () => {
    expect(parseInstanceType('wrld_abc:12345~group(grp_x)')).toBe('group')
  })

  it('returns group for ~group with an unknown groupAccessType value', () => {
    expect(parseInstanceType('wrld_abc:12345~group(grp_x)~groupAccessType(unknown)')).toBe('group')
  })

  // ── Malformed / edge cases ───────────────────────────────────────────────────

  it('returns public for null', () => {
    expect(parseInstanceType(null)).toBe('public')
  })

  it('returns public for undefined', () => {
    expect(parseInstanceType(undefined)).toBe('public')
  })

  it('returns public for an empty string', () => {
    expect(parseInstanceType('')).toBe('public')
  })

  it('returns public for a garbage string with no recognised tags', () => {
    expect(parseInstanceType('not-a-real-instance')).toBe('public')
  })

  it('ignores unknown/extra tags and returns the correct type', () => {
    // ~nonce and ~strict are real VRChat tags unrelated to access control
    expect(parseInstanceType('wrld_abc:12345~nonce(abc123)~private(usr_x)~strict')).toBe('invite')
  })
})
