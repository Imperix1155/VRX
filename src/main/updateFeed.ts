/**
 * Maps the stored update channel onto electron-updater's feed flags.
 * Stable is the public GitHub feed (`latest`). Beta and dev are explicit
 * opt-ins. An unknown value is stable, so a bad setting cannot admit a
 * prerelease.
 */
import type { UpdateChannel } from '@shared/types'

export interface UpdateFeed {
  /** electron-updater channel. Stable publishes as `latest`. */
  channel: 'latest' | 'beta' | 'dev'
  allowPrerelease: boolean
  allowDowngrade: boolean
}

export function normalizeUpdateChannel(value: unknown): UpdateChannel {
  return value === 'beta' || value === 'dev' ? value : 'stable'
}

export function updateFeedFor(channel: UpdateChannel): UpdateFeed {
  if (channel === 'beta') {
    return { channel: 'beta', allowPrerelease: true, allowDowngrade: true }
  }
  if (channel === 'dev') {
    return { channel: 'dev', allowPrerelease: true, allowDowngrade: true }
  }
  return { channel: 'latest', allowPrerelease: false, allowDowngrade: false }
}

const RELEASE_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([a-z]+)\.(?:0|[1-9]\d*))?$/

/**
 * Stable accepts only a final X.Y.Z. Beta also accepts `-beta.N` and a newer
 * stable release. Dev also accepts `-dev.N` and a newer stable release.
 * A beta build is never valid for dev, and neither prerelease is valid for stable.
 */
export function versionAllowedOnChannel(version: string, channel: UpdateChannel): boolean {
  const match = RELEASE_VERSION.exec(version)
  if (!match) return false
  const tag = match[1] ?? null
  if (channel === 'stable') return tag === null
  if (channel === 'beta') return tag === null || tag === 'beta'
  return tag === null || tag === 'dev'
}
