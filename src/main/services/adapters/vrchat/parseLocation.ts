/**
 * VRChat location → InstanceInfo parser (VRX-162).
 *
 * Converts the raw `location` string from the VRChat friends API into the
 * canonical InstanceInfo model.  PURE — no I/O, no electron, no HTTP.
 * World-name/thumbnail/group-name enrichment is a separate step (WorldResolver).
 *
 * VRChat special location values that are NOT real instances:
 *   ''          — unknown / not set
 *   'private'   — friend is in a private instance (hidden from us)
 *   'offline'   — friend is offline
 *   'traveling' — friend is between worlds
 *
 * Real instance format: "<worldId>:<instanceId>[~tag(value)...]"
 * The presence of a ':' is the reliable gate — every real location has one.
 */

import type { InstanceInfo } from '@shared/types'
import { opennessFor, parseInstanceType } from './parseInstanceType'

/** Extracts the ~region(xx) tag value, or null if absent. */
function parseRegion(instanceId: string): string | null {
  const match = /~region\(([^)]*)\)/.exec(instanceId)
  return match ? match[1] : null
}

/**
 * Parse a raw VRChat location string into an InstanceInfo, or null when the
 * location is not a real joinable instance.
 *
 * Never throws. Returns null for non-instance / hidden location values.
 */
export function parseLocation(location: string): InstanceInfo | null {
  // Non-instance sentinels (also catches empty string, since it has no colon).
  const colonIndex = location.indexOf(':')
  if (colonIndex === -1) return null

  const worldId = location.slice(0, colonIndex)
  const instanceId = location.slice(colonIndex + 1)

  if (!worldId || !instanceId) return null

  const type = parseInstanceType(instanceId)
  const openness = opennessFor(type)
  const isGroup = type === 'group-public' || type === 'group-plus' || type === 'group'

  return {
    worldId,
    instanceId,
    worldName: null,
    thumbnailUrl: null,
    type,
    openness,
    isGroup,
    groupName: null,
    region: parseRegion(instanceId),
    userCount: null
  }
}
