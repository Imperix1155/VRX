/** Reject control characters before user-entered text can become an HTTP header. */
// eslint-disable-next-line no-control-regex -- credential/header injection guard
const CONTROL_OR_DEL = /[\u0000-\u001f\u007f]/
const PRINTABLE_ASCII = /^[\u0020-\u007e]+$/

/** Direct-login text may be Unicode, but C0 controls and DEL are never safe. */
export function hasUnsafeCredentialCharacters(value: string): boolean {
  return CONTROL_OR_DEL.test(value)
}

/** Platform-issued values that are consumed in HTTP headers must be printable ASCII. */
export function isPrintableAscii(value: string): boolean {
  return PRINTABLE_ASCII.test(value)
}

/** VRChat persists only these Cookie header values after parsing Set-Cookie. */
export function isValidVrcSessionCookie(cookie: string): boolean {
  if (!isPrintableAscii(cookie)) return false
  const parts = cookie.split(/;\s*/)
  return (
    parts.length > 0 &&
    parts.every((part) => {
      const match = /^(auth|twoFactorAuth)=(.*)$/.exec(part)
      const value = match?.[2]
      return value !== undefined && isPrintableAscii(value)
    })
  )
}

/** CVR consumes both fields of its persisted session as HTTP header values. */
export function isValidCvrSession(username: string, accessKey: string): boolean {
  return isPrintableAscii(username) && isPrintableAscii(accessKey)
}
