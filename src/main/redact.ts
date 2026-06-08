/**
 * Log redaction (VRX-15)
 *
 * Pure, dependency-free credential scrubbing for log arguments. Kept separate
 * from `logger.ts` (which imports electron) so this security-critical logic stays
 * unit-testable in isolation — see VRX-13.
 */

const REDACTED = '***REDACTED***'

/** Object keys whose values must never be logged. */
const SENSITIVE_KEY =
  /^(authorization|auth|authtoken|token|password|passwd|cookie|apikey|api_key|accesskey|access_key|secret|twofactorauth)$/i

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
 * Recursively strip credentials from a log argument. Guards against circular refs.
 * Strings have inline token shapes masked; objects/arrays are walked and any value
 * under a sensitive key is replaced wholesale.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return SENSITIVE_INLINE.reduce(
      (s, re) => s.replace(re, (_m, key, sep) => `${key}${sep}${REDACTED}`),
      value
    )
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (Array.isArray(value)) return value.map((v) => redact(v, seen))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, seen)
    }
    return out
  }
  return value
}
