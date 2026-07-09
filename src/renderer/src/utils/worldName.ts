/**
 * World-name display helpers (VRX-198).
 */

/**
 * Strip a trailing ChilloutVR "(#instanceNumber)" suffix from a world name, for
 * DISPLAY only. CVR bakes the instance id into `instance.name` (e.g.
 * "SunDown (#816332)"); the hot-instance card face shows just the world, while the
 * full name + number stay in the data model for the future detail panel (VRX-59).
 *
 * Only a parens-hash-digits group at the very END is removed, so a world genuinely
 * named "Room (#2) Lounge" is untouched, and VRChat names (which never carry this
 * pattern) pass through unchanged.
 */
export function stripInstanceSuffix(worldName: string): string {
  return worldName.replace(/\s*\(#\d+\)\s*$/, '')
}
