import { describe, it, expect } from 'vitest'
import { redact } from './redact'

// OS-agnostic fixtures only (no path separators, no \n/\r\n assumptions) — CI runs
// this on both ubuntu and windows (VRX-10).
describe('redact', () => {
  it('masks values under sensitive object keys, leaving others intact', () => {
    expect(redact({ username: 'aimi', password: 'hunter2', authToken: 'tok_abc' })).toEqual({
      username: 'aimi',
      password: '***REDACTED***',
      authToken: '***REDACTED***'
    })
  })

  it('masks a VRChat auth cookie inline, preserving the separator', () => {
    expect(redact('Cookie: auth=authcookie_SECRET; path=/')).toBe(
      'Cookie: auth=***REDACTED***; path=/'
    )
  })

  it('preserves the JSON separator and quotes for an inline authToken', () => {
    expect(redact('"authToken": "jwt.body.sig"')).toBe('"authToken": "***REDACTED***"')
  })

  it('masks a Bearer token while keeping the header prefix', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer ***REDACTED***')
  })

  it('masks a CVR accessKey', () => {
    expect(redact({ Username: 'aimi', accessKey: 'AK_LIVE_999' })).toEqual({
      Username: 'aimi',
      accessKey: '***REDACTED***'
    })
  })

  it('recurses into nested structures', () => {
    expect(redact({ account: { displayName: 'aimi', cookie: 'c=1' }, friends: ['usr_1'] })).toEqual(
      {
        account: { displayName: 'aimi', cookie: '***REDACTED***' },
        friends: ['usr_1']
      }
    )
  })

  it('leaves non-sensitive data untouched', () => {
    expect(redact({ friend: 'usr_123', world: 'wrld_abc', count: 5 })).toEqual({
      friend: 'usr_123',
      world: 'wrld_abc',
      count: 5
    })
  })

  it('handles circular references without throwing', () => {
    const obj: Record<string, unknown> = { password: 'x' }
    obj.self = obj
    const result = redact(obj) as Record<string, unknown>
    expect(result.password).toBe('***REDACTED***')
    expect(result.self).toBe('[Circular]')
  })

  it('passes through primitives unchanged', () => {
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
    expect(redact('plain string')).toBe('plain string')
  })
})
