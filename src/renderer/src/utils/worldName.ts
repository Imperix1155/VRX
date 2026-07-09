/**
 * World-name display helpers (VRX-198).
 */

/**
 * Strip a trailing ChilloutVR "(#instanceTag)" suffix from a world name, for
 * DISPLAY only. CVR bakes the instance identity into `instance.name` — either a
 * machine number ("SunDown (#816332)") or a custom tag someone set
 * ("Bono's Movie Night (#teehee)"). The hot-instance card face shows just the
 * world; the full untrimmed name stays in the data model (card `title` tooltip +
 * the future detail panel, VRX-59).
 *
 * Owner call (VRX-199): strip ANY trailing parenthesized "(#…)" group — numeric
 * OR custom — since both are instance identity, not the world's base name.
 *
 * Only a `(#…)` group at the very END is removed, so:
 *  - a hashtag that's part of the real name ("Room #5", "#Neon Club") is untouched
 *    (not wrapped in trailing parens),
 *  - a mid-name group ("Room (#2) Lounge") is untouched (not at the end),
 *  - VRChat names (which never carry this pattern) pass through unchanged.
 * The rare world genuinely named "Gallery (#3)" trims on the face but keeps its
 * full name in the tooltip/detail panel.
 */
export function stripInstanceSuffix(worldName: string): string {
  return worldName.replace(/\s*\(#[^)]*\)\s*$/, '')
}
