import { describe, expect, it } from 'vitest'
import { parseLocation } from './parseLocation'

// ─── Null / non-instance inputs ───────────────────────────────────────────────

describe('parseLocation — non-instance inputs → null', () => {
  it('returns null for empty string', () => {
    expect(parseLocation('')).toBeNull()
  })

  it('returns null for "private"', () => {
    expect(parseLocation('private')).toBeNull()
  })

  it('returns null for "offline"', () => {
    expect(parseLocation('offline')).toBeNull()
  })

  it('returns null for "traveling"', () => {
    expect(parseLocation('traveling')).toBeNull()
  })

  it('returns null for a garbage string without a colon', () => {
    expect(parseLocation('not-a-location')).toBeNull()
  })
})

// ─── worldId / instanceId split ──────────────────────────────────────────────

describe('parseLocation — worldId + instanceId', () => {
  it('splits worldId before the first colon and instanceId after', () => {
    const result = parseLocation('wrld_abc:12345')
    expect(result).not.toBeNull()
    expect(result!.worldId).toBe('wrld_abc')
    expect(result!.instanceId).toBe('12345')
  })

  it('instanceId includes all tags after the nonce', () => {
    const result = parseLocation('wrld_abc:12345~region(us)~hidden(usr_x)')
    expect(result!.instanceId).toBe('12345~region(us)~hidden(usr_x)')
  })
})

// ─── Public instance ──────────────────────────────────────────────────────────

describe('parseLocation — public instance', () => {
  it('returns type=public, openness=public, isGroup=false', () => {
    const result = parseLocation('wrld_abc:12345')
    expect(result!.type).toBe('public')
    expect(result!.openness).toBe('public')
    expect(result!.isGroup).toBe(false)
  })

  it('handles a public instance with a region tag', () => {
    const result = parseLocation('wrld_abc:12345~region(us)')
    expect(result!.type).toBe('public')
    expect(result!.region).toBe('us')
    expect(result!.isGroup).toBe(false)
  })
})

// ─── Friends+ instance ────────────────────────────────────────────────────────

describe('parseLocation — friends-plus instance', () => {
  it('returns type=friends-plus, openness=friends-plus, isGroup=false', () => {
    const result = parseLocation('wrld_abc:12345~hidden(usr_x)')
    expect(result!.type).toBe('friends-plus')
    expect(result!.openness).toBe('friends-plus')
    expect(result!.isGroup).toBe(false)
  })
})

// ─── Friends instance ─────────────────────────────────────────────────────────

describe('parseLocation — friends instance', () => {
  it('returns type=friends, openness=friends, isGroup=false', () => {
    const result = parseLocation('wrld_abc:12345~friends(usr_x)')
    expect(result!.type).toBe('friends')
    expect(result!.openness).toBe('friends')
    expect(result!.isGroup).toBe(false)
  })
})

// ─── Invite instance ──────────────────────────────────────────────────────────

describe('parseLocation — invite instance', () => {
  it('returns type=invite, openness=invite, isGroup=false', () => {
    const result = parseLocation('wrld_abc:12345~private(usr_x)')
    expect(result!.type).toBe('invite')
    expect(result!.openness).toBe('invite')
    expect(result!.isGroup).toBe(false)
  })

  it('returns type=invite-plus for ~private + ~canRequestInvite', () => {
    const result = parseLocation('wrld_abc:12345~private(usr_x)~canRequestInvite')
    expect(result!.type).toBe('invite-plus')
    expect(result!.openness).toBe('invite-plus')
    expect(result!.isGroup).toBe(false)
  })
})

// ─── Group instances ──────────────────────────────────────────────────────────

describe('parseLocation — group instances', () => {
  it('group-public: type=group-public, openness=public, isGroup=true', () => {
    const result = parseLocation('wrld_abc:12345~group(grp_x)~groupAccessType(public)')
    expect(result!.type).toBe('group-public')
    expect(result!.openness).toBe('public')
    expect(result!.isGroup).toBe(true)
  })

  it('group-plus: type=group-plus, openness=friends-plus, isGroup=true', () => {
    const result = parseLocation('wrld_abc:12345~group(grp_x)~groupAccessType(plus)')
    expect(result!.type).toBe('group-plus')
    expect(result!.openness).toBe('friends-plus')
    expect(result!.isGroup).toBe(true)
  })

  it('group (members-only): type=group, openness=invite, isGroup=true', () => {
    const result = parseLocation('wrld_abc:12345~group(grp_x)~groupAccessType(members)')
    expect(result!.type).toBe('group')
    expect(result!.openness).toBe('invite')
    expect(result!.isGroup).toBe(true)
  })
})

// ─── Region parsing ───────────────────────────────────────────────────────────

describe('parseLocation — region tag', () => {
  it('parses ~region(us) → region="us"', () => {
    const result = parseLocation('wrld_abc:12345~region(us)')
    expect(result!.region).toBe('us')
  })

  it('parses ~region(eu) → region="eu"', () => {
    const result = parseLocation('wrld_abc:12345~hidden(usr_x)~region(eu)')
    expect(result!.region).toBe('eu')
  })

  it('returns null for region when ~region tag is absent', () => {
    const result = parseLocation('wrld_abc:12345~hidden(usr_x)')
    expect(result!.region).toBeNull()
  })
})

// ─── Enrichment fields are always null (deferred) ────────────────────────────

describe('parseLocation — deferred enrichment fields', () => {
  it('worldName is always null (enrichment deferred)', () => {
    expect(parseLocation('wrld_abc:12345')!.worldName).toBeNull()
  })

  it('thumbnailUrl is always null', () => {
    expect(parseLocation('wrld_abc:12345')!.thumbnailUrl).toBeNull()
  })

  it('groupName is always null', () => {
    expect(
      parseLocation('wrld_abc:12345~group(grp_x)~groupAccessType(public)')!.groupName
    ).toBeNull()
  })

  it('userCount is always null', () => {
    expect(parseLocation('wrld_abc:12345')!.userCount).toBeNull()
  })
})
