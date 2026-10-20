// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_LOGIN_PLATFORM_STORAGE_KEY,
  readLastLoginPlatform,
  rememberLoginPlatform
} from './lastLoginPlatform'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('lastLoginPlatform', () => {
  it('defaults to VRChat when nothing is stored', () => {
    expect(readLastLoginPlatform()).toBe('vrchat')
  })

  it('round-trips both platforms', () => {
    rememberLoginPlatform('chilloutvr')
    expect(readLastLoginPlatform()).toBe('chilloutvr')
    rememberLoginPlatform('vrchat')
    expect(readLastLoginPlatform()).toBe('vrchat')
  })

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(LAST_LOGIN_PLATFORM_STORAGE_KEY, 'neos')
    expect(readLastLoginPlatform()).toBe('vrchat')
  })

  it('falls back to VRChat when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => rememberLoginPlatform('chilloutvr')).not.toThrow()
    expect(readLastLoginPlatform()).toBe('vrchat')
  })
})
