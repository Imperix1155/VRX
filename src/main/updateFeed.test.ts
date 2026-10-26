import { describe, expect, it } from 'vitest'
import {
  normalizeUpdateChannel,
  selectReleaseVersion,
  updateFeedFor,
  versionAllowedOnChannel
} from './updateFeed'

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
      allowDowngrade: false
    })
    expect(updateFeedFor('dev')).toEqual({
      channel: 'dev',
      allowPrerelease: true,
      allowDowngrade: false
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

  it('picks a newer stable release for dev ahead of a beta and an older dev build', () => {
    expect(
      selectReleaseVersion(
        ['1.3.0-beta.1', '1.2.0', '1.2.0-dev.1', '1.2.0-rc.1'],
        'dev',
        '1.2.0-dev.1'
      )
    ).toBe('1.2.0')
    expect(selectReleaseVersion(['1.2.0'], 'dev', '1.2.0-dev.1')).toBe('1.2.0')
    expect(
      selectReleaseVersion(['1.3.0-dev.1', '1.2.0', '1.2.0-beta.4'], 'dev', '1.2.0-dev.1')
    ).toBe('1.3.0-dev.1')
    expect(selectReleaseVersion(['1.2.0-beta.2'], 'dev', '1.2.0-dev.1')).toBeNull()
    expect(selectReleaseVersion(['1.2.0-dev.3', '1.1.0'], 'dev', '1.2.0')).toBeNull()
    expect(selectReleaseVersion(['1.2.0', '1.4.0', '1.10.0-dev.2'], 'dev', '1.2.0-dev.1')).toBe(
      '1.10.0-dev.2'
    )
  })

  it('reports no update when every accepted release is older than the running build', () => {
    for (const channel of ['stable', 'beta', 'dev'] as const) {
      expect(selectReleaseVersion(['1.1.1', '1.0.0'], channel, '1.2.0')).toBeNull()
      expect(selectReleaseVersion(['1.1.1', '1.2.0'], channel, '1.2.1-dev.1')).toBeNull()
    }
    expect(selectReleaseVersion(['1.1.1', '1.2.0-dev.4'], 'dev', '1.2.1-dev.1')).toBeNull()
    expect(selectReleaseVersion(['1.1.1', '1.2.0-beta.4'], 'beta', '1.2.0')).toBeNull()
    expect(selectReleaseVersion(['1.2.0-dev.3', '1.1.1'], 'dev', '1.2.0')).toBeNull()
    expect(selectReleaseVersion(['1.3.0'], 'dev', '1.2.1-dev.1')).toBe('1.3.0')
    expect(selectReleaseVersion(['1.2.1-dev.2', '1.1.1'], 'dev', '1.2.1-dev.1')).toBe('1.2.1-dev.2')
  })
})
