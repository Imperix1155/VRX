/**
 * VRChat join-URL builder (VRX-50).
 *
 * Builds `vrchat://launch?ref=vrchat.com&id=<worldId>:<instanceId>`.
 * The instanceId already carries `~type(owner)~region(...)` tags — do NOT
 * re-encode them (URLSearchParams / new URL() would percent-encode `:`, `(`, `)`)
 * so this function concatenates the string directly.
 *
 * The `open-url` IPC handler accepts this launch URL via `isAllowedLaunchUrl`
 * (`src/main/ipc/url-allowlist.ts`) — a strict `vrchat://launch?id=wrld_…` predicate
 * added in VRX-161. (`isAllowedUrl` itself still permits only `https:`.)
 */

/** `wrld_` prefix pattern VRChat uses for world IDs. */
const WORLD_ID_RE = /^wrld_/

/**
 * Build a VRChat join URL.
 *
 * @param worldId   World ID, must start with `wrld_`.
 * @param instanceId  Instance ID including `~type(...)~nonce(...)` etc. tags.
 *                    Must be non-empty (empty instanceId = private/offline, not joinable).
 * @param region    Optional region tag. Appended as `~region(<region>)` only when
 *                  the instanceId does not already contain `~region(`.
 * @returns The launch URL string, or `null` if the inputs are not joinable.
 */
export function buildJoinUrl(worldId: string, instanceId: string, region?: string): string | null {
  if (!worldId || !WORLD_ID_RE.test(worldId)) return null
  if (!instanceId) return null

  let id = instanceId
  if (region && !instanceId.includes('~region(')) {
    id = `${instanceId}~region(${region})`
  }

  return `vrchat://launch?ref=vrchat.com&id=${worldId}:${id}`
}
