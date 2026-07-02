/**
 * Log redaction (VRX-15; hardened in the 2026-07 baseline audit, wave W2)
 *
 * Pure, dependency-free credential scrubbing for log arguments. Kept separate
 * from `logger.ts` (which imports electron) so this security-critical logic stays
 * unit-testable in isolation — see VRX-13.
 *
 * Coverage boundary (know what this can and cannot see):
 * - Strings: inline token shapes + bare JWTs are masked.
 * - Plain objects/arrays: walked recursively; values under sensitive keys are
 *   replaced wholesale. Only OWN ENUMERABLE STRING-KEYED properties are visible.
 * - Errors: handled explicitly (message/stack are non-enumerable and would
 *   otherwise vanish) — name/message/stack are kept and string-masked, and any
 *   enumerable extras (e.g. retryAfterMs) plus `cause` and AggregateError's
 *   `errors` are walked.
 * - Other non-plain objects (Map/Set/URL/class instances backed by getters or
 *   Symbols) collapse to a visible '[unredactable: Ctor]' marker instead of a
 *   silent, misleading `{}`.
 *
 * RESIDUAL RISK (know before logging): string masking is SHAPE-based (key=value,
 * key: value, Bearer, JWT, authcookie_*). An arbitrary bare secret embedded in
 * prose — including inside an Error message — cannot be recognized and WILL pass
 * through. Never interpolate raw credentials into error/log strings. Likewise the
 * 2FA IPC field is literally named `code` — too generic to key-match safely — so
 * ipc/auth.ts must continue to never log its request payloads.
 */

const REDACTED = '***REDACTED***'

/**
 * Sensitive-key detection. Keys are normalized (lowercased, separators stripped)
 * and matched on UNAMBIGUOUS substrings, so `accessToken`, `access_token`,
 * `refresh-token`, `sessionId`, `client_secret`, `XSRF-TOKEN`, … all hit without
 * enumerating every casing.
 *
 * `auth` needs care: as a bare substring it would also match `author`/`authorName`
 * (real VRChat world metadata we WANT in logs). Rule: the normalized key is
 * sensitive if it IS `auth`, contains `authorization`, or starts with `auth` but
 * not `author` (`authtoken`, `authcookie`, `authheader`, …).
 */
const SENSITIVE_SUBSTRINGS = [
  'token',
  'secret',
  'password',
  'passwd',
  'cookie',
  'credential',
  'apikey',
  'accesskey',
  'privatekey',
  'sessionid',
  'twofactor',
  '2fa',
  'bearer',
  'jwt'
] as const

function isSensitiveKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (SENSITIVE_SUBSTRINGS.some((s) => norm.includes(s))) return true
  if (norm === 'auth' || norm.includes('authorization')) return true
  return norm.startsWith('auth') && !norm.startsWith('author')
}

/**
 * Inline token shapes (VRChat `auth=`/`twoFactorAuth=` cookies, `authToken: ...`,
 * `Authorization: Bearer ...`). Each pattern captures the key as group 1 and the
 * separator (incl. any quote/whitespace) as group 2, so the replacement can keep
 * the original delimiter and replace only the secret value.
 */
const SENSITIVE_INLINE: readonly RegExp[] = [
  /\b(auth|twoFactorAuth|authcookie)(=)[^;,\s]+/gi,
  /\b(authToken|accessKey|password|apiKey)("?\s*[:=]\s*"?)[^",}\s]+/gi,
  /\b(Bearer)(\s+)[^\s,;"]+/gi
]

/**
 * VRChat session cookies have a known literal shape (`authcookie_<id>`), so a BARE
 * one — pasted into prose or an Error message with no `auth=` prefix — is still
 * recognizable. Masked wholesale, independent of key context.
 */
const BARE_AUTHCOOKIE = /\bauthcookie_[A-Za-z0-9-]+/g

/**
 * Bare JWT floor: three base64url segments of realistic length. Catches a raw
 * token logged under an unrecognized key or on its own, independent of any
 * key/prefix context. Segment minimums keep semver/paths/prose from matching.
 */
const BARE_JWT = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g

function redactString(s: string): string {
  const masked = SENSITIVE_INLINE.reduce(
    (acc, re) => acc.replace(re, (_m, key, sep) => `${key}${sep}${REDACTED}`),
    s
  )
  return masked.replace(BARE_AUTHCOOKIE, REDACTED).replace(BARE_JWT, REDACTED)
}

/** True for objects the entries-walk can faithfully represent. */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Recursively strip credentials from a log argument. Guards against circular refs.
 * Strings have inline token shapes masked; plain objects/arrays are walked and any
 * value under a sensitive key is replaced wholesale; Errors keep (masked)
 * name/message/stack; other non-plain objects become a visible marker.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value)
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (Array.isArray(value)) return value.map((v) => redact(v, seen))
    if (value instanceof Error) {
      // message/stack are non-enumerable — an entries-walk would silently drop
      // them (the {} trap this hardening exists to close). Keep them, masked.
      // Subclasses don't auto-set .name — prefer the constructor name when .name
      // is still the default (the app's own error classes set both; this covers
      // third-party ones that don't).
      const ctorName = value.constructor?.name
      const out: Record<string, unknown> = {
        name: value.name === 'Error' && ctorName && ctorName !== 'Error' ? ctorName : value.name,
        message: redactString(value.message),
        stack: typeof value.stack === 'string' ? redactString(value.stack) : undefined
      }
      for (const [k, v] of Object.entries(value)) {
        out[k] = isSensitiveKey(k) ? REDACTED : redact(v, seen)
      }
      if (value.cause !== undefined) out.cause = redact(value.cause, seen)
      // AggregateError.errors is ALSO non-enumerable — walk it explicitly or the
      // inner errors vanish silently (the same trap as message/stack).
      if (value instanceof AggregateError) {
        out.errors = value.errors.map((e) => redact(e, seen))
      }
      return out
    }
    if (!isPlainObject(value)) {
      // Map/Set/URL/getter-backed class instances: entries-walk sees nothing, so
      // emit a visible marker instead of a silent (and misleading) `{}`.
      const ctor = value.constructor?.name ?? 'object'
      return `[unredactable: ${ctor}]`
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, seen)
    }
    return out
  }
  return value
}
