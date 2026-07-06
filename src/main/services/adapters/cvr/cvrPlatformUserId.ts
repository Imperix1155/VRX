/**
 * Stable ChilloutVR platformUserId extractor (VRX-61).
 *
 * CVR roster and presence wires identify users with GUIDs. Normalize casing and
 * whitespace once, validate the GUID shape, and return an explicit failure so
 * callers can skip malformed records without throwing away the whole payload.
 */

export type CvrPlatformUserIdResult =
  { ok: true; platformUserId: string } | { ok: false; reason: 'empty' | 'malformed' }

const CVR_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function extractCvrPlatformUserId(rawId: string): CvrPlatformUserIdResult {
  const platformUserId = rawId.trim().toLowerCase()
  if (platformUserId.length === 0) return { ok: false, reason: 'empty' }
  if (!CVR_GUID_RE.test(platformUserId)) return { ok: false, reason: 'malformed' }
  return { ok: true, platformUserId }
}
