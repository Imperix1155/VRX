import { describe, expect, it } from 'vitest'
import { normalizeUpdateChannel, updateFeedFor, versionAllowedOnChannel } from './updateFeed'

describe('update feed', () => {
  it('maps the stored channel onto electron-updater and treats anything else as stable', () => {
    expect(updateFeedFor('stable')).toEqual({
      channel: 'latest',
      allowPrerelease: false,
      allowDowngrade: false
    })
    expect(updateFeedFor('beta')).toEqual({
      channel: 'beta',
      allowPrerelease: true,
      allowDowngrade: true
    })
    expect(updateFeedFor('dev')).toEqual({
      channel: 'dev',
      allowPrerelease: true,
      allowDowngrade: true
    })
    for (const value of [undefined, null, '', 'latest', 'rc', 'nightly', 1]) {
      expect(normalizeUpdateChannel(value)).toBe('stable')
    }
  })

  it('admits only versions that belong on the selected channel', () => {
    expect(versionAllowedOnChannel('1.2.0', 'stable')).toBe(true)
    expect(versionAllowedOnChannel('1.2.0-beta.1', 'stable')).toBe(false)
    expect(versionAllowedOnChannel('1.2.0-dev.1', 'stable')).toBe(false)
    expect(versionAllowedOnChannel('1.2.0-rc.1', 'stable')).toBe(false)

    expect(versionAllowedOnChannel('1.2.0', 'beta')).toBe(true)
    expect(versionAllowedOnChannel('1.2.0-beta.2', 'beta')).toBe(true)
    expect(versionAllowedOnChannel('1.2.0-dev.2', 'beta')).toBe(false)

    expect(versionAllowedOnChannel('1.2.0', 'dev')).toBe(true)
    expect(versionAllowedOnChannel('1.2.0-dev.3', 'dev')).toBe(true)
    expect(versionAllowedOnChannel('1.2.0-beta.3', 'dev')).toBe(false)

    for (const version of ['1.2.0-beta', '1.2.0-beta.01', '1.2.0-alpha.1', '01.0.0', 'nope']) {
      expect(versionAllowedOnChannel(version, 'beta')).toBe(false)
      expect(versionAllowedOnChannel(version, 'dev')).toBe(false)
    }
  })
})
