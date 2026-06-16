import { describe, expect, it } from 'vitest'
import { isAllowedUrl } from './url-allowlist'

describe('isAllowedUrl', () => {
  it('allows exact known hosts', () => {
    expect(isAllowedUrl('https://vrchat.com/home')).toBe(true)
    expect(isAllowedUrl('https://vrchat.cloud')).toBe(true)
    expect(isAllowedUrl('https://github.com/Imperix1155/VRX')).toBe(true)
    expect(isAllowedUrl('https://chilloutvr.net')).toBe(true)
    expect(isAllowedUrl('https://abinteractive.net')).toBe(true)
  })

  it('allows subdomains of known hosts', () => {
    expect(isAllowedUrl('https://api.vrchat.cloud/api/1/auth/user')).toBe(true)
    expect(isAllowedUrl('https://assets.vrchat.com')).toBe(true)
    expect(isAllowedUrl('https://api.abinteractive.net/1')).toBe(true)
    expect(isAllowedUrl('https://api.chilloutvr.net/1/users/ws')).toBe(true)
  })

  it('denies HTTP', () => {
    expect(isAllowedUrl('http://vrchat.com')).toBe(false)
    expect(isAllowedUrl('http://github.com')).toBe(false)
  })

  it('denies non-https protocols', () => {
    expect(isAllowedUrl('ftp://vrchat.com')).toBe(false)
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedUrl('file:///etc/passwd')).toBe(false)
  })

  it('denies unknown hosts', () => {
    expect(isAllowedUrl('https://evil.com')).toBe(false)
    expect(isAllowedUrl('https://malicious.xyz')).toBe(false)
  })

  it('denies look-alike hosts (prefix attack)', () => {
    expect(isAllowedUrl('https://vrchat.com.evil.com')).toBe(false)
    expect(isAllowedUrl('https://not-vrchat.com')).toBe(false)
    expect(isAllowedUrl('https://myvrchat.com')).toBe(false)
  })

  it('denies malformed URLs', () => {
    expect(isAllowedUrl('')).toBe(false)
    expect(isAllowedUrl('not a url')).toBe(false)
    expect(isAllowedUrl('://missing-protocol.com')).toBe(false)
  })
})
