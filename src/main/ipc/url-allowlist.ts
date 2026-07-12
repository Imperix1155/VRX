import { CVR_INSTANCE_ID_RE } from '../services/adapters/cvr/buildCvrJoinUrl'

/**
 * URL allowlist for shell.openExternal (VRX-20, VRX-161).
 * Only HTTPS URLs with a known host (or subdomain thereof) are permitted.
 * Pure function — no electron imports — so it stays unit-testable.
 */

const ALLOWED_HOSTS = [
  'vrchat.com',
  'vrchat.cloud',
  'abinteractive.net',
  'chilloutvr.net',
  'github.com'
] as const

export function isAllowedUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

const MAX_LAUNCH_URL_LENGTH = 2048
const VRC_LAUNCH_ID_RE = /^wrld_[A-Za-z0-9_-]{1,128}:[A-Za-z0-9][A-Za-z0-9_~().-]{0,767}$/

function hasExactParams(url: URL, allowed: ReadonlySet<string>): boolean {
  const keys = [...url.searchParams.keys()]
  return (
    keys.length === allowed.size &&
    new Set(keys).size === keys.length &&
    keys.every((key) => allowed.has(key))
  )
}

/**
 * Permit only the two strict game-launch contracts used by join-instance.
 *
 * Valid form: `vrchat://launch?ref=vrchat.com&id=<worldId>:<instanceId>[~tags]`
 * as emitted by `buildJoinUrl.ts`.
 *
 * Threat model:
 * This predicate is deliberately NOT used by renderer-facing open-url.
 *
 * Note: callers pass the raw string (not `url.href`) to `shell.openExternal`.
 * This is intentional: `buildJoinUrl` leaves `:`, `(`, `)` unencoded in the
 * instance-tag segment, and `url.href` would re-percent-encode them, breaking
 * the launch URL that VRChat's client expects.
 *
 */
export function isAllowedLaunchUrl(raw: string): boolean {
  if (raw.length === 0 || raw.length > MAX_LAUNCH_URL_LENGTH || raw.includes('#')) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '' || url.port !== '') return false

  if (raw.startsWith('vrchat://launch?')) {
    if (raw.includes('%')) return false
    if (url.protocol !== 'vrchat:' || url.hostname !== 'launch' || url.pathname !== '') return false
    const keys = [...url.searchParams.keys()]
    const allowed = new Set(['id', 'ref'])
    if (new Set(keys).size !== keys.length || keys.some((key) => !allowed.has(key))) return false
    const id = url.searchParams.get('id')
    const ref = url.searchParams.get('ref')
    return VRC_LAUNCH_ID_RE.test(id ?? '') && (ref === null || ref === 'vrchat.com')
  }

  if (raw.startsWith('chilloutvr://instance/join?')) {
    if (url.protocol !== 'chilloutvr:' || url.hostname !== 'instance' || url.pathname !== '/join') {
      return false
    }
    if (!hasExactParams(url, new Set(['instanceId', 'startInVR']))) return false
    const instanceId = url.searchParams.get('instanceId') ?? ''
    const startInVR = url.searchParams.get('startInVR') ?? ''
    if (!CVR_INSTANCE_ID_RE.test(instanceId) || !/^(?:true|false)$/.test(startInVR)) return false
    return url.search === `?instanceId=${encodeURIComponent(instanceId)}&startInVR=${startInVR}`
  }

  return false
}
