import { describe, expect, it } from 'vitest'
import {
  hasUnsafeCredentialCharacters,
  isPrintableAscii,
  isValidCvrSession,
  isValidVrcSessionCookie
} from './credentialValidation'

describe('credential validation', () => {
  it('rejects C0 controls and DEL without rejecting Unicode direct-login text', () => {
    const controls = [
      ['NUL', '\u0000'],
      ['SOH', '\u0001'],
      ['tab', '\t'],
      ['line feed', '\n'],
      ['vertical tab', '\u000b'],
      ['form feed', '\f'],
      ['carriage return', '\r'],
      ['DEL', '\u007f']
    ] as const

    for (const [name, control] of controls) {
      expect(hasUnsafeCredentialCharacters(`name${control}password`), name).toBe(true)
    }
    expect(hasUnsafeCredentialCharacters('ユーザー🔐')).toBe(false)
  })

  it('accepts printable ASCII issued values and rejects header controls', () => {
    expect(isPrintableAscii('token-ABC_123=/+')).toBe(true)
    expect(isPrintableAscii('token\nnext')).toBe(false)
    expect(isPrintableAscii('token\u007fnext')).toBe(false)
  })

  it('accepts only printable auth and twoFactorAuth cookie values', () => {
    expect(isValidVrcSessionCookie('auth=session=token; twoFactorAuth=second-token')).toBe(true)
    expect(isValidVrcSessionCookie('auth=session\npoison')).toBe(false)
    expect(isValidVrcSessionCookie('auth=clean;\r\ntwoFactorAuth=also-clean')).toBe(false)
    expect(isValidVrcSessionCookie('auth=clean;\ttwoFactorAuth=also-clean')).toBe(false)
  })

  it('requires both CVR-issued session fields to be printable ASCII', () => {
    expect(isValidCvrSession('issued-user', 'issued-key')).toBe(true)
    expect(isValidCvrSession('issued\nuser', 'issued-key')).toBe(false)
    expect(isValidCvrSession('issued-user', 'issued\tkey')).toBe(false)
    expect(isValidCvrSession('ユーザー', 'issued-key')).toBe(false)
    expect(isValidCvrSession('issued-user', '鍵')).toBe(false)
  })
})
