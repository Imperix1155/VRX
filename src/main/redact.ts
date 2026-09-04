/**
 * Pure credential scrubber with capped regex scans, reflective reads, and output.
 *
 * This is defense in depth, not semantic PII detection. Callers must not pass
 * arbitrary private data under generic keys; Error extras remain available for
 * intentional diagnostics while known credential keys and shapes are masked.
 */
const REDACTED = '***REDACTED***'
const MAX_DEPTH = 4
const MAX_KEYS = 20
const MAX_KEY_LENGTH = 128
const MAX_STRING_LENGTH = 2048
const STRING_REDACTION_LOOKAHEAD = 64
const UNREPRESENTABLE = '[unrepresentable diagnostic]'

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
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (SENSITIVE_SUBSTRINGS.some((item) => normalized.includes(item))) return true
  if (normalized === 'auth' || normalized.includes('authorization')) return true
  return normalized.startsWith('auth') && !normalized.startsWith('author')
}
const SENSITIVE_INLINE: readonly RegExp[] = [
  /\b(auth|twoFactorAuth|authcookie)(=)[^;,\s]+/gi,
  /\b(authToken|accessKey|password|apiKey)("?\s*[:=]\s*"?)[^",}\s]+/gi,
  /\b(Bearer)(\s+)[^\s,;"]+/gi
]
const BARE_AUTHCOOKIE = /(?<![A-Za-z0-9])authcookie_[A-Za-z0-9-]+/g
const BARE_JWT = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
function redactString(value: string): string {
  const masked = SENSITIVE_INLINE.reduce(
    (current, expression) =>
      current.replace(expression, (_match, key, separator) => `${key}${separator}${REDACTED}`),
    value
  )
  return masked.replace(BARE_AUTHCOOKIE, REDACTED).replace(BARE_JWT, REDACTED)
}

function isJwtCharacter(value: string): boolean {
  const code = value.charCodeAt(0)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95
  )
}

/**
 * A bounded scan can end inside any of a JWT's three unbounded base64url
 * segments. When the source continues, replace the trailing candidate (up to
 * two preceding dotted segments) instead of emitting an unverified raw prefix.
 */
function redactTruncatedJwtCandidate(value: string): string {
  let cursor = value.length
  let includedDots = 0
  if (cursor === 0) return value
  if (value[cursor - 1] === '.') {
    cursor -= 1
    includedDots = 1
  } else if (!isJwtCharacter(value[cursor - 1]!)) {
    return value
  }

  const trailingSegmentEnd = cursor
  while (cursor > 0 && isJwtCharacter(value[cursor - 1]!)) cursor -= 1
  if (cursor === trailingSegmentEnd) return value

  let candidateStart = cursor
  while (includedDots < 2 && candidateStart > 0 && value[candidateStart - 1] === '.') {
    const previousSegmentEnd = candidateStart - 1
    let previousSegmentStart = previousSegmentEnd
    while (previousSegmentStart > 0 && isJwtCharacter(value[previousSegmentStart - 1]!)) {
      previousSegmentStart -= 1
    }
    if (previousSegmentStart === previousSegmentEnd) break
    candidateStart = previousSegmentStart
    includedDots += 1
  }

  return `${value.slice(0, candidateStart)}${REDACTED}`
}

type DescriptorWalk = { entries: Array<[string, PropertyDescriptor]>; overflow: boolean }

function safeEnumerableOwnDescriptors(value: object): DescriptorWalk | null {
  try {
    const entries: Array<[string, PropertyDescriptor]> = []
    let traversalAttempts = 0
    for (const key in value) {
      traversalAttempts += 1
      if (traversalAttempts > MAX_KEYS || key.length > MAX_KEY_LENGTH) {
        return { entries, overflow: true }
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable) continue
      entries.push([key, descriptor])
    }
    return { entries, overflow: false }
  } catch {
    return null
  }
}

function safeFixedDescriptors(
  value: object,
  keys: readonly string[]
): Record<string, PropertyDescriptor | undefined> | null {
  try {
    const descriptors: Record<string, PropertyDescriptor | undefined> = {}
    for (const key of keys) descriptors[key] = Object.getOwnPropertyDescriptor(value, key)
    return descriptors
  } catch {
    return null
  }
}
function descriptorValue(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor && 'value' in descriptor ? descriptor.value : '[unreadable accessor]'
}
function boundedString(value: string): string {
  const scanLength = MAX_STRING_LENGTH + STRING_REDACTION_LOOKAHEAD
  const scannedSource = value.slice(0, scanLength)
  const scanned =
    value.length > scanLength ? redactTruncatedJwtCandidate(scannedSource) : scannedSource
  const redacted = redactString(scanned)
  return value.length > MAX_STRING_LENGTH || redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}…`
    : redacted
}
function safeOwnString(value: object, key: string): string | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? boundedString(descriptor.value)
      : null
  } catch {
    return null
  }
}
function safeErrorName(
  value: object,
  descriptors: Record<string, PropertyDescriptor | undefined>
): string {
  const name = descriptors.name
  if (name && 'value' in name && typeof name.value === 'string') return boundedString(name.value)
  try {
    const prototype = Object.getPrototypeOf(value) as object | null
    const descriptor: PropertyDescriptor | undefined = prototype
      ? Object.getOwnPropertyDescriptor(prototype, 'constructor')
      : undefined
    const constructor: unknown =
      descriptor && 'value' in descriptor ? (descriptor.value as unknown) : undefined
    return typeof constructor === 'function'
      ? (safeOwnString(constructor, 'name') ?? 'Error')
      : 'Error'
  } catch {
    return 'Error'
  }
}
function isError(value: object): boolean {
  try {
    return value instanceof Error
  } catch {
    return false
  }
}

function isPlainRecord(value: object): boolean {
  try {
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

/** Projects capped plain-record diagnostics; accessors and opaque instances never run. */
export function redact(value: unknown, path = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return boundedString(value)
  if (typeof value === 'symbol' || typeof value === 'function' || typeof value === 'bigint')
    return UNREPRESENTABLE
  if (!value || typeof value !== 'object') return value
  if (path.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[max diagnostic depth]'
  path.add(value)
  try {
    if (isError(value)) {
      const descriptors = safeFixedDescriptors(value, [
        'name',
        'message',
        'stack',
        'cause',
        'errors'
      ])
      if (!descriptors) return UNREPRESENTABLE
      const walked = safeEnumerableOwnDescriptors(value)
      if (!walked || walked.overflow) return UNREPRESENTABLE
      const specialNonEnumerableCount = Object.values(descriptors).filter(
        (descriptor) => descriptor && !descriptor.enumerable
      ).length
      if (walked.entries.length + specialNonEnumerableCount > MAX_KEYS) return UNREPRESENTABLE
      const message = descriptors.message
      const stack = descriptors.stack
      const output: Record<string, unknown> = {
        name: safeErrorName(value, descriptors),
        message:
          message && 'value' in message && typeof message.value === 'string'
            ? boundedString(message.value)
            : undefined,
        stack:
          stack && 'value' in stack && typeof stack.value === 'string'
            ? boundedString(stack.value)
            : stack
              ? '[unreadable accessor]'
              : undefined
      }
      for (const [key, descriptor] of walked.entries) {
        if (!descriptor.enumerable || ['name', 'message', 'stack', 'cause', 'errors'].includes(key))
          continue
        output[key] = isSensitiveKey(key)
          ? REDACTED
          : redact(descriptorValue(descriptor), path, depth + 1)
      }
      const cause = descriptors.cause
      if (cause && 'value' in cause) output.cause = redact(cause.value, path, depth + 1)
      const errors = descriptors.errors
      if (errors && 'value' in errors) output.errors = redact(errors.value, path, depth + 1)
      return output
    }
    if (ArrayBuffer.isView(value)) return '[binary diagnostic]'
    // Do not create sparse output or inspect unbounded array descriptors. A
    // normal array is represented only when its bounded own keys are data keys.
    try {
      if (Array.isArray(value)) {
        const walked = safeEnumerableOwnDescriptors(value)
        if (!walked) return UNREPRESENTABLE
        if (walked.overflow || walked.entries.some(([key]) => !/^\d+$/.test(key)))
          return '[array diagnostic]'
        return walked.entries.map(([, descriptor]) =>
          redact(descriptorValue(descriptor), path, depth + 1)
        )
      }
    } catch {
      return UNREPRESENTABLE
    }
    if (!isPlainRecord(value)) return UNREPRESENTABLE
    const descriptors = safeFixedDescriptors(value, ['name', 'message', 'code', 'cause'])
    if (!descriptors) return UNREPRESENTABLE
    const walked = safeEnumerableOwnDescriptors(value)
    if (!walked) return UNREPRESENTABLE
    const specialNonEnumerableCount = Object.values(descriptors).filter(
      (descriptor) => descriptor && !descriptor.enumerable
    ).length
    if (
      walked.overflow ||
      walked.entries.length + specialNonEnumerableCount > MAX_KEYS ||
      walked.entries.some(([key]) => /^\d+$/.test(key))
    )
      return '[binary-like diagnostic]'
    const output: Record<string, unknown> = {}
    for (const key of ['name', 'message', 'code', 'cause']) {
      const descriptor = descriptors[key]
      if (descriptor && 'value' in descriptor)
        output[key] = isSensitiveKey(key) ? REDACTED : redact(descriptor.value, path, depth + 1)
    }
    for (const [key, descriptor] of walked.entries) {
      if (!descriptor.enumerable || key in output) continue
      output[key] = isSensitiveKey(key)
        ? REDACTED
        : redact(descriptorValue(descriptor), path, depth + 1)
    }
    return Object.keys(output).length > 0 ? output : UNREPRESENTABLE
  } finally {
    path.delete(value)
  }
}
