/**
 * electron-updater 6.8.9's GitHub provider promotes a channel to stable only
 * for the built-in `alpha` and `beta` names. A custom `dev` channel matches
 * `-dev.N` tags and nothing else, so `1.2.0-dev.1` stays put after `1.2.0`
 * ships, and a feed with no dev tag fails the check. Mapping dev onto beta
 * would select a newer beta ahead of an older stable. This resolver walks the
 * same atom feed and fetches `dev.yml` or `latest.yml` for the chosen tag.
 */
import {
  CancellationToken,
  HttpError,
  newError,
  parseXml,
  type UpdateInfo
} from 'builder-util-runtime'
import { getChannelFilename, newUrlFromBase } from 'electron-updater/out/util.js'
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider.js'
import { canonicalReleaseVersion, releasePrereleaseKind, selectReleaseVersion } from './updateFeed'

const PATCHED: unique symbol = Symbol('vrxDevStablePromotion')
const TAG_HREF = /\/tag\/(v?[^/]+)$/

interface ReleaseTag {
  /** Atom href tag, including a leading `v` when GitHub published one. */
  tag: string
  version: string
}

interface DevUpdater {
  channel: string | null
  allowPrerelease: boolean
  allowDowngrade: boolean
  currentVersion?: { raw?: string; version?: string } | string
}

interface DevGitHubProvider {
  options: { owner: string; repo: string }
  baseUrl: URL
  updater: DevUpdater
  httpRequest(
    url: URL,
    headers?: Record<string, string> | null,
    cancellationToken?: CancellationToken
  ): Promise<string | null>
  executor: {
    request(options: unknown, cancellationToken?: CancellationToken): Promise<string | null>
  }
  createRequestOptions(url: URL): unknown
  getCustomChannelName(channel: string): string
  getDefaultChannelName(): string
  getBaseDownloadPath(tag: string, fileName: string): string
}

interface DevProto {
  getLatestVersion: (this: DevGitHubProvider) => Promise<UpdateInfo & { tag: string }>
  [PATCHED]?: boolean
}

function currentVersionOf(updater: DevUpdater): string {
  const current = updater.currentVersion
  if (typeof current === 'string') return current
  return current?.raw ?? current?.version ?? '0.0.0'
}

function releaseTags(feedXml: string): ReleaseTag[] {
  const feed = parseXml(feedXml)
  const tags: ReleaseTag[] = []
  for (const entry of feed.getElements('entry')) {
    try {
      const link = entry.elementOrNull('link')
      const href = link?.attribute('href')
      const match = href ? TAG_HREF.exec(href) : null
      const tag = match?.[1]
      if (!tag) continue
      const version = canonicalReleaseVersion(tag)
      if (version == null) continue
      tags.push({ tag, version })
    } catch {
      // A release entry without a tag link is not a VRX build.
    }
  }
  return tags
}

function channelFileName(provider: DevGitHubProvider, version: string): string {
  const kind = releasePrereleaseKind(version)
  const channelName =
    kind === 'dev' ? provider.getCustomChannelName('dev') : provider.getDefaultChannelName()
  return getChannelFilename(channelName)
}

async function requestFile(
  provider: DevGitHubProvider,
  tag: string,
  channelFile: string,
  cancellationToken: CancellationToken
): Promise<{ raw: string; channelFile: string; channelFileUrl: URL }> {
  const channelFileUrl = newUrlFromBase(
    provider.getBaseDownloadPath(tag, channelFile),
    provider.baseUrl
  )
  const raw = await provider.executor.request(
    provider.createRequestOptions(channelFileUrl),
    cancellationToken
  )
  if (raw == null) {
    throw newError(
      `Cannot find ${channelFile} in the latest release artifacts (${channelFileUrl.href})`,
      'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
    )
  }
  return { raw, channelFile, channelFileUrl }
}

async function readChannelFile(
  provider: DevGitHubProvider,
  tag: string,
  version: string,
  cancellationToken: CancellationToken,
  allowLatestFallback: boolean
): Promise<{ raw: string; channelFile: string; channelFileUrl: URL }> {
  try {
    return await requestFile(provider, tag, channelFileName(provider, version), cancellationToken)
  } catch (error) {
    const missing = error instanceof HttpError && error.statusCode === 404
    if (!missing || !allowLatestFallback) throw error
    return requestFile(
      provider,
      tag,
      getChannelFilename(provider.getDefaultChannelName()),
      cancellationToken
    )
  }
}

function nothingNewer(version: string): UpdateInfo & { tag: string } {
  return {
    tag: version.startsWith('v') ? version : `v${version}`,
    version,
    files: [],
    path: '',
    sha512: '',
    releaseDate: new Date(0).toISOString(),
    releaseName: null,
    releaseNotes: null
  }
}

/** Latest stable or `-dev.N` for a provider whose updater channel is `dev`. */
export async function latestDevOrStable(
  provider: DevGitHubProvider
): Promise<UpdateInfo & { tag: string }> {
  const cancellationToken = new CancellationToken()
  const feedUrl = newUrlFromBase(
    `/${provider.options.owner}/${provider.options.repo}/releases.atom`,
    provider.baseUrl
  )
  const feedXml = await provider.httpRequest(
    feedUrl,
    { accept: 'application/xml, application/atom+xml, text/xml, */*' },
    cancellationToken
  )
  if (feedXml == null) {
    throw newError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
  }
  let tags: ReleaseTag[]
  try {
    tags = releaseTags(feedXml)
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    throw newError(`Cannot parse releases feed: ${message}`, 'ERR_UPDATER_INVALID_RELEASE_FEED')
  }
  if (tags.length === 0) {
    throw newError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
  }
  const current = currentVersionOf(provider.updater)
  const selectedVersion = selectReleaseVersion(
    tags.map((entry) => entry.version),
    'dev',
    current,
    provider.updater.allowDowngrade === true
  )
  if (selectedVersion == null) return nothingNewer(current)
  const selected = tags.find((entry) => entry.version === selectedVersion)
  if (selected == null) return nothingNewer(current)
  const prerelease = releasePrereleaseKind(selected.version)
  const file = await readChannelFile(
    provider,
    selected.tag,
    selected.version,
    cancellationToken,
    prerelease === 'dev'
  )
  const parsed = parseUpdateInfo(file.raw, file.channelFile, file.channelFileUrl)
  return { tag: selected.tag, ...parsed }
}

/**
 * Teach GitHubProvider's `dev` channel to discover a newer stable release.
 * Stable and beta keep the library's own lookup. Idempotent.
 */
export function installDevStablePromotion(providerClass: { prototype: object }): void {
  const proto = providerClass.prototype as DevProto
  if (proto[PATCHED]) return
  const original = proto.getLatestVersion
  proto.getLatestVersion = function (this: DevGitHubProvider) {
    if (this.updater?.channel !== 'dev' || this.updater.allowPrerelease !== true) {
      return original.call(this)
    }
    return latestDevOrStable(this)
  }
  proto[PATCHED] = true
}
