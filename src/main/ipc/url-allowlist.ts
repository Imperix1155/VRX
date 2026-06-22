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

/**
 * Permit VRChat desktop-launch URLs (VRX-161).
 *
 * Valid form: `vrchat://launch?ref=vrchat.com&id=<worldId>:<instanceId>[~tags]`
 * as emitted by `buildJoinUrl.ts`.
 *
 * Threat model:
 * - `vrchat:` is the only custom scheme allowed; all others remain rejected.
 * - `hostname` must be exactly `launch` (case-insensitive; non-special schemes
 *   are not auto-lowercased by the URL parser, so we lowercase explicitly).
 * - The `id` query param must start with `wrld_` — the prefix VRChat uses for
 *   all world IDs.  This rejects blank, missing, or attacker-controlled IDs
 *   while remaining agnostic about the instance-tag grammar (`~type(...)`, etc.).
 * - `ref` is not a security boundary and is not validated.
 *
 * Note: callers pass the raw string (not `url.href`) to `shell.openExternal`.
 * This is intentional: `buildJoinUrl` leaves `:`, `(`, `)` unencoded in the
 * instance-tag segment, and `url.href` would re-percent-encode them, breaking
 * the launch URL that VRChat's client expects.
 *
 * TODO: add the ChilloutVR launch scheme here when it is confirmed (VRX-161).
 *
 * This predicate is intentionally separate from `isAllowedUrl` so the web-link
 * path (used by `setWindowOpenHandler`) never accepts a custom scheme.
 */
export function isAllowedLaunchUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'vrchat:') return false
  if (url.hostname.toLowerCase() !== 'launch') return false
  const id = url.searchParams.get('id')
  return typeof id === 'string' && id.startsWith('wrld_')
}
