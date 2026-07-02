import { describe, it, expect } from 'vitest'
import { redact } from './redact'

// OS-agnostic fixtures only (no path separators, no \n/\r\n assumptions) — CI runs
// this on both ubuntu and windows (VRX-10).
describe('redact', () => {
  it('masks values under sensitive object keys, leaving others intact', () => {
    expect(redact({ username: 'testuser', password: 'hunter2', authToken: 'tok_abc' })).toEqual({
      username: 'testuser',
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
    expect(redact({ Username: 'testuser', accessKey: 'AK_LIVE_999' })).toEqual({
      Username: 'testuser',
      accessKey: '***REDACTED***'
    })
  })

  it('recurses into nested structures', () => {
    expect(
      redact({ account: { displayName: 'testuser', cookie: 'c=1' }, friends: ['usr_1'] })
    ).toEqual({
      account: { displayName: 'testuser', cookie: '***REDACTED***' },
      friends: ['usr_1']
    })
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

  // ─── 2026-07 audit W2: substring key matching ────────────────────────────────
  // These key names all bypassed the old ^exact-word$ matcher (verified in audit).

  it.each([
    'accessToken',
    'sessionToken',
    'refreshToken',
    'access_token',
    'refresh_token',
    'id_token',
    'client_secret',
    'sessionId',
    'XSRF-TOKEN',
    'private_key',
    'twoFactorCode'
  ])('redacts the previously-bypassing key %s', (key) => {
    const result = redact({ [key]: 'sensitive-value' }) as Record<string, unknown>
    expect(result[key]).toBe('***REDACTED***')
  })

  it('does NOT redact author-family keys (VRChat world metadata)', () => {
    expect(redact({ author: 'a', authorName: 'b', authorId: 'usr_1' })).toEqual({
      author: 'a',
      authorName: 'b',
      authorId: 'usr_1'
    })
  })

  it.each(['auth', 'Authorization', 'authCookie', 'auth_header'])(
    'still redacts the auth-family key %s',
    (key) => {
      const result = redact({ [key]: 'v' }) as Record<string, unknown>
      expect(result[key]).toBe('***REDACTED***')
    }
  )

  // ─── W2: bare-JWT floor ──────────────────────────────────────────────────────
  // Fixture built at runtime so no token-shaped literal lands in the repo (gitleaks).

  it('masks a bare JWT-shaped token with no key context', () => {
    const jwt = `${'h'.repeat(24)}.${'p'.repeat(16)}.${'s'.repeat(16)}`
    expect(redact(`unexpected: ${jwt} in log line`)).toBe('unexpected: ***REDACTED*** in log line')
  })

  it('leaves short dotted strings (semver, hostnames) untouched', () => {
    expect(redact('vrx 1.2.3 at api.vrchat.cloud')).toBe('vrx 1.2.3 at api.vrchat.cloud')
  })

  // ─── W2: Error handling (non-enumerable message/stack used to vanish to {}) ──

  it('keeps an Error name/message/stack, with inline secrets masked', () => {
    const result = redact(new Error('login failed: auth=authcookie_abc; retry')) as Record<
      string,
      unknown
    >
    expect(result.name).toBe('Error')
    expect(result.message).toBe('login failed: auth=***REDACTED***; retry')
    expect(typeof result.stack).toBe('string')
  })

  it('preserves enumerable extras on custom Errors and redacts sensitive ones', () => {
    class RateLimitError extends Error {
      retryAfterMs = 8000
      accessToken = 'tok'
    }
    const result = redact(new RateLimitError('slow down')) as Record<string, unknown>
    expect(result.name).toBe('RateLimitError')
    expect(result.message).toBe('slow down')
    expect(result.retryAfterMs).toBe(8000)
    expect(result.accessToken).toBe('***REDACTED***')
  })

  it('walks an Error cause chain', () => {
    const inner = new Error('inner: auth=xyz')
    const outer = new Error('outer', { cause: inner })
    const result = redact(outer) as Record<string, unknown>
    const cause = result.cause as Record<string, unknown>
    expect(cause.message).toBe('inner: auth=***REDACTED***')
  })

  it('walks AggregateError.errors (also non-enumerable) instead of dropping them', () => {
    const agg = new AggregateError([new Error('first: auth=abc'), new Error('second')], 'multi')
    const result = redact(agg) as Record<string, unknown>
    const errors = result.errors as Array<Record<string, unknown>>
    expect(errors).toHaveLength(2)
    expect(errors[0].message).toBe('first: auth=***REDACTED***')
    expect(errors[1].message).toBe('second')
  })

  it('masks a BARE authcookie (no key prefix) — e.g. pasted into an Error message', () => {
    const result = redact(new Error(`restore ok for authcookie_${'a'.repeat(24)}`)) as Record<
      string,
      unknown
    >
    expect(result.message).toBe('restore ok for ***REDACTED***')
  })

  // ─── W2: non-plain objects surface a marker instead of a silent {} ───────────

  it('marks Map/Set/URL as unredactable instead of emitting {}', () => {
    expect(redact(new Map([['password', 'x']]))).toBe('[unredactable: Map]')
    expect(redact(new Set(['secret']))).toBe('[unredactable: Set]')
    expect(redact(new URL('https://vrchat.com/?auth=x'))).toBe('[unredactable: URL]')
  })

  it('keeps a genuinely empty plain object as {}', () => {
    expect(redact({})).toEqual({})
  })
})
