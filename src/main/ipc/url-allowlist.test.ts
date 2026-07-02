import { describe, expect, it } from 'vitest'
import { isAllowedUrl, isAllowedLaunchUrl } from './url-allowlist'

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

  // ── 2026-07 audit W6 ─────────────────────────────────────────────────────────

  it('denies Cyrillic homoglyph hosts (IDN spoof)', () => {
    // 'vrсhat.com' with a Cyrillic Es (U+0441) — visually identical, different
    // host. The URL parser punycodes it to xn--*, which must not match.
    expect(isAllowedUrl('https://vrсhat.com')).toBe(false)
    expect(isAllowedUrl('https://api.vrсhat.com/login')).toBe(false)
  })

  it('denies protocol-relative and scheme-less forms', () => {
    // Protocol-relative: would inherit the embedding context's scheme — there
    // is no such context here, and new URL() rejects it without a base.
    expect(isAllowedUrl('//vrchat.com/home')).toBe(false)
    expect(isAllowedUrl('vrchat.com/home')).toBe(false)
  })
})

describe('isAllowedLaunchUrl', () => {
  it('allows well-formed vrchat launch URLs', () => {
    // Canonical form emitted by buildJoinUrl
    expect(isAllowedLaunchUrl('vrchat://launch?ref=vrchat.com&id=wrld_abc123:1~region(us)')).toBe(
      true
    )
    // Without optional ref param
    expect(isAllowedLaunchUrl('vrchat://launch?id=wrld_abc123:1')).toBe(true)
    // With instance tags (~private, ~nonce, etc.)
    expect(
      isAllowedLaunchUrl('vrchat://launch?id=wrld_abc123:1~private(usr_xyz)~nonce(abc)~region(us)')
    ).toBe(true)
    // Uppercase scheme/host — URL parser preserves case for non-special schemes,
    // but our predicate lowercases before comparing
    expect(isAllowedLaunchUrl('VRCHAT://LAUNCH?id=wrld_abc123:1')).toBe(true)
  })

  it('denies arbitrary vrchat:// paths (not launch)', () => {
    expect(isAllowedLaunchUrl('vrchat://evil')).toBe(false)
    expect(isAllowedLaunchUrl('vrchat://admin?id=wrld_abc:1')).toBe(false)
    expect(isAllowedLaunchUrl('vrchat://home')).toBe(false)
  })

  it('denies launch URL with missing or non-wrld_ id', () => {
    expect(isAllowedLaunchUrl('vrchat://launch')).toBe(false)
    expect(isAllowedLaunchUrl('vrchat://launch?id=')).toBe(false)
    expect(isAllowedLaunchUrl('vrchat://launch?id=evil_world:1')).toBe(false)
    expect(isAllowedLaunchUrl('vrchat://launch?id=../../../etc/passwd')).toBe(false)
  })

  it('denies credential-injection via userinfo', () => {
    // vrchat://launch@evil.com parses hostname as evil.com, not launch
    expect(isAllowedLaunchUrl('vrchat://launch@evil.com?id=wrld_abc:1')).toBe(false)
  })

  it('denies authority decoration even when the host is launch (userinfo / port)', () => {
    // hostname IS launch here, but the strict predicate rejects any userinfo/port
    expect(isAllowedLaunchUrl('vrchat://user:pass@launch?id=wrld_abc:1')).toBe(false)
    expect(isAllowedLaunchUrl('vrchat://user@launch?id=wrld_abc:1')).toBe(false)
    expect(isAllowedLaunchUrl('vrchat://launch:1234?id=wrld_abc:1')).toBe(false)
  })

  it('denies non-vrchat custom schemes', () => {
    expect(isAllowedLaunchUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedLaunchUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedLaunchUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isAllowedLaunchUrl('steam://run/123')).toBe(false)
  })

  it('denies https URLs (isAllowedUrl domain, not isAllowedLaunchUrl)', () => {
    expect(isAllowedLaunchUrl('https://vrchat.com/home')).toBe(false)
    expect(isAllowedLaunchUrl('https://vrchat.com/launch?id=wrld_abc:1')).toBe(false)
  })

  it('denies malformed URLs', () => {
    expect(isAllowedLaunchUrl('')).toBe(false)
    expect(isAllowedLaunchUrl('not a url')).toBe(false)
  })

  it('isAllowedUrl still rejects vrchat: scheme (asymmetry preserved)', () => {
    // The web-link path must never accept custom schemes
    expect(isAllowedUrl('vrchat://launch?ref=vrchat.com&id=wrld_abc:1')).toBe(false)
    expect(isAllowedUrl('vrchat://evil')).toBe(false)
  })
})
