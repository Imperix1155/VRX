import { describe, it, expect } from 'vitest'
import { buildJoinUrl } from './buildJoinUrl'

describe('buildJoinUrl', () => {
  // ─── Happy path ───────────────────────────────────────────────────────────

  it('builds the canonical join URL', () => {
    const url = buildJoinUrl('wrld_abc123', '12345~public')
    expect(url).toBe('vrchat://launch?ref=vrchat.com&id=wrld_abc123:12345~public')
  })

  it('preserves a full instanceId with tags verbatim', () => {
    const instanceId = '12345~friends(usr_xyz)~region(us)~nonce(abc)'
    const url = buildJoinUrl('wrld_abc123', instanceId)
    expect(url).toBe(`vrchat://launch?ref=vrchat.com&id=wrld_abc123:${instanceId}`)
  })

  // ─── Encoding regression — must NOT percent-encode special chars ──────────

  it('contains a literal colon between worldId and instanceId (not %3A)', () => {
    const url = buildJoinUrl('wrld_abc123', '12345~public')
    expect(url).not.toContain('%3A')
    expect(url).toContain('wrld_abc123:12345~public')
  })

  it('preserves literal parentheses in instance tags (not %28/%29)', () => {
    const instanceId = '12345~friends(usr_xyz)~nonce(abc)'
    const url = buildJoinUrl('wrld_abc123', instanceId)
    expect(url).not.toContain('%28')
    expect(url).not.toContain('%29')
    expect(url).toContain('~friends(usr_xyz)')
  })

  it('preserves literal tildes in instance tags (not %7E)', () => {
    const url = buildJoinUrl('wrld_abc123', '12345~public~region(us)')
    expect(url).not.toContain('%7E')
    expect(url).toContain('~public~region(us)')
  })

  // ─── Region handling ──────────────────────────────────────────────────────

  it('appends region when not already present', () => {
    const url = buildJoinUrl('wrld_abc123', '12345~public', 'us')
    expect(url).toBe('vrchat://launch?ref=vrchat.com&id=wrld_abc123:12345~public~region(us)')
  })

  it('does not duplicate region when instanceId already has ~region(', () => {
    const instanceId = '12345~public~region(eu)'
    const url = buildJoinUrl('wrld_abc123', instanceId, 'us')
    expect(url).toBe(`vrchat://launch?ref=vrchat.com&id=wrld_abc123:${instanceId}`)
    expect(url).not.toContain('~region(us)')
  })

  it('does not append region when region param is not provided', () => {
    const url = buildJoinUrl('wrld_abc123', '12345~public')
    expect(url).not.toContain('~region(')
  })

  it('does not append region when region param is an empty string', () => {
    const url = buildJoinUrl('wrld_abc123', '12345~public', '')
    expect(url).not.toContain('~region(')
  })

  // ─── Null cases ──────────────────────────────────────────────────────────

  it('returns null when worldId is empty', () => {
    expect(buildJoinUrl('', '12345~public')).toBeNull()
  })

  it('returns null when worldId does not start with wrld_', () => {
    expect(buildJoinUrl('world_abc123', '12345~public')).toBeNull()
    expect(buildJoinUrl('wrld', '12345~public')).toBeNull()
    expect(buildJoinUrl('WRLD_abc123', '12345~public')).toBeNull()
  })

  it('returns null when instanceId is empty (private/offline instance)', () => {
    expect(buildJoinUrl('wrld_abc123', '')).toBeNull()
  })
})
