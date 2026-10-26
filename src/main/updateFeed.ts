/**
 * Maps the stored update channel onto electron-updater's feed flags.
 * Stable is the public GitHub feed (`latest`). Beta and dev are explicit
 * opt-ins. An unknown value is stable, so a bad setting cannot admit a
 * prerelease.
 *
 * electron-updater 6.8.9 promotes a custom channel to stable only for its
 * built-in `alpha` and `beta` channels. Mapping dev onto beta would offer
 * beta builds, so dev selection goes through `selectReleaseVersion` instead.
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
  // allowDowngrade stays off on every channel. electron-updater's channel
  // setter turns it on, so the caller must assign this value afterwards.
  // A check, including one started by a channel change, never offers an
  // older build.
  if (channel === 'beta') {
    return { channel: 'beta', allowPrerelease: true, allowDowngrade: false }
  }
  if (channel === 'dev') {
    return { channel: 'dev', allowPrerelease: true, allowDowngrade: false }
  }
  return { channel: 'latest', allowPrerelease: false, allowDowngrade: false }
}

const RELEASE_VERSION =
  /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([a-z]+)\.((?:0|[1-9]\d*)))?$/

interface ReleaseParts {
  major: number
  minor: number
  patch: number
  tag: string | null
  n: number
}

function releaseParts(version: string): ReleaseParts | null {
  const match = RELEASE_VERSION.exec(version)
  const core = match?.[1]
  if (!core) return null
  const [major, minor, patch] = core.split('.').map((part) => Number(part))
  if (major == null || minor == null || patch == null) return null
  const tag = match[2] ?? null
  return { major, minor, patch, tag, n: tag == null ? 0 : Number(match[3]) }
}

/**
 * Drop a single leading `v` and keep the version only when it is `X.Y.Z` or
 * `X.Y.Z-tag.N`. GitHub tag hrefs include the `v`.
 */
export function canonicalReleaseVersion(tag: string): string | null {
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  return releaseParts(version) == null ? null : version
}

/** `beta` from `1.2.0-beta.1`. A final release has no kind. */
export function releasePrereleaseKind(version: string): string | null {
  return releaseParts(version)?.tag ?? null
}

/**
 * Stable accepts only a final X.Y.Z. Beta also accepts `-beta.N` and a newer
 * stable release. Dev also accepts `-dev.N` and a newer stable release.
 * A beta build is never valid for dev, and neither prerelease is valid for stable.
 */
export function versionAllowedOnChannel(version: string, channel: UpdateChannel): boolean {
  const tag = releasePrereleaseKind(version)
  if (releaseParts(version) == null) return false
  if (channel === 'stable') return tag === null
  if (channel === 'beta') return tag === null || tag === 'beta'
  return tag === null || tag === 'dev'
}

/**
 * Semver order for the versions this feed accepts. A final release is newer
 * than its own pre-release. Pre-release tags compare alphabetically, then by
 * N, which matches semver for `beta`, `dev`, and `rc`.
 */
function compareReleases(left: string, right: string): number | null {
  const a = releaseParts(left)
  const b = releaseParts(right)
  if (a == null || b == null) return null
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.tag == null && b.tag == null) return 0
  if (a.tag == null) return 1
  if (b.tag == null) return -1
  if (a.tag !== b.tag) return a.tag < b.tag ? -1 : 1
  return a.n - b.n
}

/**
 * Greatest release on `channel` that is newer than `currentVersion`.
 * Equal versions, older versions, and anything the channel rejects are
 * skipped. A normal check and a channel change both refuse a downgrade.
 * Returns null when the feed has nothing newer to install.
 */
export function selectReleaseVersion(
  versions: readonly string[],
  channel: UpdateChannel,
  currentVersion: string
): string | null {
  if (releaseParts(currentVersion) == null) return null
  let newer: string | null = null
  for (const version of versions) {
    if (!versionAllowedOnChannel(version, channel)) continue
    const order = compareReleases(version, currentVersion)
    if (order == null || order <= 0) continue
    if (newer == null || (compareReleases(version, newer) ?? 0) > 0) newer = version
  }
  return newer
}
