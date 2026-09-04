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

  it('redacts both branches of a shared-reference DAG without claiming a cycle', () => {
    const shared = { password: 'x', label: 'shared' }

    expect(redact({ a: shared, b: shared })).toEqual({
      a: { password: '***REDACTED***', label: 'shared' },
      b: { password: '***REDACTED***', label: 'shared' }
    })
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

  it('masks a credential that crosses the bounded string scan boundary', () => {
    const prefix = `${'x'.repeat(2035)} `
    const credential = `authcookie_${'a'.repeat(24)}`
    const result = redact(`${prefix}${credential}`) as string

    expect(result).toBe(`${prefix}${'***REDACTED***'.slice(0, 12)}…`)
    expect(result).not.toContain(credential)
    expect(result).toHaveLength(2049)
  })

  it('masks a long JWT candidate whose first segment crosses the scan boundary', () => {
    const prefix = `${'x'.repeat(1999)} `
    const jwt = `${'h'.repeat(120)}.${'p'.repeat(10)}.${'s'.repeat(10)}`
    const result = redact(`${prefix}${jwt}`) as string

    expect(result).toBe(`${prefix}***REDACTED***…`)
    expect(result).not.toContain(jwt.slice(0, 40))
  })

  it('bounds an 8 MiB credential before applying redaction expressions', () => {
    const result = redact(`authcookie_${'a'.repeat(8 * 1024 * 1024)}`)

    expect(result).toBe('***REDACTED***…')
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

  it('masks credential shapes in explicit and constructor-derived Error names', () => {
    const credentialShape = `authcookie_${'a'.repeat(24)}`
    const explicitlyNamed = new Error('safe')
    explicitlyNamed.name = `Remote ${credentialShape}`
    const oversizedName = new Error('safe')
    oversizedName.name = 'x'.repeat(3000)
    let constructorNameReads = 0

    class RemoteError extends Error {}
    Object.defineProperty(RemoteError, 'name', { value: `Remote_${credentialShape}` })
    const proxiedConstructor = new Proxy(
      function RemoteProxyError() {
        return undefined
      },
      {
        get: (target, key, receiver) => {
          if (key === 'name') {
            constructorNameReads += 1
            return credentialShape
          }
          return Reflect.get(target, key, receiver)
        },
        getOwnPropertyDescriptor: (target, key) =>
          key === 'name'
            ? { configurable: true, value: `Remote_${credentialShape}` }
            : Reflect.getOwnPropertyDescriptor(target, key)
      }
    )
    const proxyNamed = new Error('safe')
    Object.setPrototypeOf(
      proxyNamed,
      Object.create(Error.prototype, {
        constructor: { configurable: true, value: proxiedConstructor }
      })
    )

    expect(redact(explicitlyNamed)).toMatchObject({ name: 'Remote ***REDACTED***' })
    expect(redact(new RemoteError('safe'))).toMatchObject({ name: 'Remote_***REDACTED***' })
    expect(redact(oversizedName)).toMatchObject({ name: '***REDACTED***…' })
    expect(redact(proxyNamed)).toMatchObject({ name: 'Remote_***REDACTED***' })
    expect(constructorNameReads).toBe(0)
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

  it('accepts exactly 20 Error descriptors and rejects 21', () => {
    const withDescriptorCount = (count: number): Error => {
      const error = new Error('bounded diagnostic')
      const baseCount = Object.keys(Object.getOwnPropertyDescriptors(error)).length
      for (let index = baseCount; index < count; index += 1) {
        Object.defineProperty(error, `detail${index}`, { enumerable: true, value: index })
      }
      expect(Object.keys(Object.getOwnPropertyDescriptors(error))).toHaveLength(count)
      return error
    }

    expect(redact(withDescriptorCount(20))).toMatchObject({ message: 'bounded diagnostic' })
    expect(redact(withDescriptorCount(21))).toBe('[unrepresentable diagnostic]')
  })

  it('bounds Error descriptor reads instead of materializing every descriptor', () => {
    let descriptorReads = 0
    const error = new Error('bounded')
    const extras = Array.from({ length: 100 }, (_, index) => `detail${index}`)
    const hostile = new Proxy(error, {
      ownKeys: (target) => [...Reflect.ownKeys(target), ...extras],
      getOwnPropertyDescriptor: (target, key) => {
        descriptorReads += 1
        if (typeof key === 'string' && extras.includes(key)) {
          return { configurable: true, enumerable: true, value: key }
        }
        return Reflect.getOwnPropertyDescriptor(target, key)
      }
    })

    expect(redact(hostile)).toBe('[unrepresentable diagnostic]')
    expect(descriptorReads).toBeLessThanOrEqual(50)
  })

  it('counts inherited enumerable Error fields against the traversal bound', () => {
    const prototype = Object.create(Error.prototype) as Record<string, unknown>
    for (let index = 0; index < 100; index += 1) prototype[`inherited${index}`] = index
    const error = new Error('bounded')
    Object.setPrototypeOf(error, prototype)

    expect(redact(error)).toBe('[unrepresentable diagnostic]')
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
    expect(errors[0]!.message).toBe('first: auth=***REDACTED***')
  })

  it('masks a BARE authcookie (no key prefix) — e.g. pasted into an Error message', () => {
    const result = redact(new Error(`restore ok for authcookie_${'a'.repeat(24)}`)) as Record<
      string,
      unknown
    >
    expect(result.message).toBe('restore ok for ***REDACTED***')
  })

  // ─── W2: non-plain objects surface a marker instead of a silent {} ───────────

  it('marks opaque platform objects instead of inspecting them', () => {
    expect(redact(new Map([['password', 'x']]))).toBe('[unrepresentable diagnostic]')
    expect(redact(new Set(['secret']))).toBe('[unrepresentable diagnostic]')
    expect(redact(new URL('https://vrchat.com/?auth=x'))).toBe('[unrepresentable diagnostic]')
  })

  it('keeps custom instances opaque instead of trusting generic diagnostic fields', () => {
    class UpdaterMetadata {
      message = 'login failed for an account owner'
      code = 'EACCES'
      path = '/private/account/update.zip'
      value = 'unlabelled credential material'
      client_secret = 'secret'
    }

    expect(redact(new UpdaterMetadata())).toBe('[unrepresentable diagnostic]')
  })

  it('marks binary views without enumerating their byte contents', () => {
    const binary = new Uint8Array([65, 66, 67])
    const buffer = Buffer.from([68, 69])
    const dataView = new DataView(new ArrayBuffer(2))

    expect(redact(binary)).toBe('[binary diagnostic]')
    expect(redact(buffer)).toBe('[binary diagnostic]')
    expect(redact(dataView)).toBe('[binary diagnostic]')
    expect(redact(binary.buffer)).toBe('[unrepresentable diagnostic]')
  })

  it('never invokes diagnostic getters while retaining readable own data', () => {
    const plain = { code: 'EACCES' } as Record<string, unknown>
    Object.defineProperty(plain, 'cachePath', {
      enumerable: true,
      get: () => {
        throw new Error('getter must not run')
      }
    })
    const error = new Error('write failed')

    expect(() => redact({ plain, error })).not.toThrow()
    expect(redact(plain)).toEqual({ code: 'EACCES', cachePath: '[unreadable accessor]' })
    expect(redact(error)).toMatchObject({ message: 'write failed' })
  })

  it('degrades safely when a proxy rejects descriptor inspection', () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('descriptor trap must not run through')
        },
        ownKeys: () => ['secret']
      }
    )

    expect(() => redact(hostile)).not.toThrow()
    expect(redact(hostile)).toBe('[unrepresentable diagnostic]')
  })

  it('bounds plain-record descriptor reads instead of materializing every descriptor', () => {
    let descriptorReads = 0
    const extras = Array.from({ length: 100 }, (_, index) => `detail${index}`)
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => extras,
        getOwnPropertyDescriptor: (_target, key) => {
          descriptorReads += 1
          return typeof key === 'string' && extras.includes(key)
            ? { configurable: true, enumerable: true, value: key }
            : undefined
        }
      }
    )

    expect(redact(hostile)).toBe('[binary-like diagnostic]')
    expect(descriptorReads).toBeLessThanOrEqual(50)
  })

  it('fails closed before normalizing or copying an oversized property name', () => {
    const oversizedKey = 'x'.repeat(8 * 1024 * 1024)

    expect(redact({ [oversizedKey]: 'value' })).toBe('[binary-like diagnostic]')
  })

  it('accepts exactly 20 plain-record fields and rejects 21', () => {
    const withDescriptorCount = (count: number): Record<string, unknown> => {
      const record: Record<string, unknown> = {}
      for (const key of ['name', 'message', 'code', 'cause']) {
        Object.defineProperty(record, key, { value: key })
      }
      for (let index = 4; index < count; index += 1) record[`detail${index}`] = index
      return record
    }

    expect(Object.keys(redact(withDescriptorCount(20)) as object)).toHaveLength(20)
    expect(redact(withDescriptorCount(21))).toBe('[binary-like diagnostic]')
  })

  it('accepts exactly 20 dense array entries and rejects 21', () => {
    expect(redact(Array.from({ length: 20 }, (_, index) => index))).toHaveLength(20)
    expect(redact(Array.from({ length: 21 }, (_, index) => index))).toBe('[array diagnostic]')
  })

  it('keeps Error diagnostics compatible with the established redactor contract', () => {
    const error = new Error('unused')
    error.name = 'DiagnosticError'
    const hostile = new Proxy(Buffer.from([1, 2, 3]), {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap')
      }
    })
    const coercion = {
      toString: () => {
        throw new Error('toString')
      }
    }
    class Diagnostic {
      code = 'ENOSPC'
    }

    expect(redact(error)).toMatchObject({ name: 'DiagnosticError' })
    expect(redact(hostile)).toBe('[unrepresentable diagnostic]')
    expect(redact(coercion)).toBe('[unrepresentable diagnostic]')
    expect(redact(new Diagnostic())).toBe('[unrepresentable diagnostic]')
  })

  it('does not invoke hostile Error accessors while retaining safe partial diagnostics', () => {
    let reads = 0
    const error = new Error('safe')
    for (const key of ['message', 'stack', 'cause', 'extra'] as const) {
      Object.defineProperty(error, key, {
        enumerable: key === 'extra',
        get: () => {
          reads += 1
          throw new Error(`${key} getter`)
        }
      })
    }
    expect(() => redact(error)).not.toThrow()
    expect(reads).toBe(0)
    expect(redact(error)).toMatchObject({ name: 'Error', stack: '[unreadable accessor]' })
  })

  it('contains revoked or descriptor-hostile Error proxies without forwarding trap values', () => {
    const descriptorHostile = new Proxy(new Error('SECRET'), {
      ownKeys: () => {
        throw new Error('descriptor trap')
      }
    })
    const revoked = Proxy.revocable(new Error('SECRET'), {})
    revoked.revoke()

    expect(() => redact(descriptorHostile)).not.toThrow()
    expect(redact(descriptorHostile)).toBe('[unrepresentable diagnostic]')
    expect(() => redact(revoked.proxy)).not.toThrow()
    expect(redact(revoked.proxy)).toBe('[unrepresentable diagnostic]')
  })

  it('keeps a genuinely empty plain object as {}', () => {
    expect(redact({})).toBe('[unrepresentable diagnostic]')
  })
})
