/**
 * Instance-pill constants (VRX-198) — kept in a plain util (not the component file)
 * so `InstancePill.tsx` exports ONLY its component (react-refresh rule, same reason
 * `viewTitles.ts` / `segmented.ts` are separate).
 */
import type { InstanceInfo, InstanceType, LabelScheme } from '@shared/types'
import { LABEL_KEYS_BY_SCHEME } from './instanceTypeLabels'

/**
 * Openness-ladder tier per InstanceType (DESIGN.md §6) — keys the pill's `--op-*`
 * color tokens. Friend ladder green→orange (open→locked); groups purple (lighter =
 * more open). `null` = neutral pill (CVR Offline Instance — not joinable).
 */
export type OpennessTier =
  | 'public'
  | 'friends-plus'
  | 'friends'
  | 'invite-plus'
  | 'invite'
  | 'group-public'
  | 'group-plus'
  | 'group'

export const OPENNESS_TIER: Record<InstanceType, OpennessTier | null> = {
  // VRChat types
  public: 'public',
  'friends-plus': 'friends-plus',
  friends: 'friends',
  'invite-plus': 'invite-plus',
  invite: 'invite',
  'group-public': 'group-public',
  'group-plus': 'group-plus',
  group: 'group',
  // CVR types (same §6 tiers, platform-true labels)
  'friends-of-friends': 'friends-plus',
  'everyone-can-invite': 'invite-plus',
  'owner-must-invite': 'invite',
  'friends-of-members': 'group-plus',
  'members-only': 'group',
  offline: null
}

/**
 * Shared pill GEOMETRY (no color, no width floor). The Friends-tab instance pill and
 * the Dashboard platform pill both build on this so their shape/size can't drift.
 * Width floor + grid placement stay with consumers (VRX-198).
 */
export const PILL_BASE =
  'inline-flex h-[28px] shrink-0 items-center justify-center ' +
  'rounded-[10px] border px-[12px] text-[12px] font-semibold whitespace-nowrap'

/**
 * THE one resolver for an instance-type pill's label key + tier (VRX-244).
 *
 * `parseCvrPrivacy` degrades an unrecognized CVR privacy value to a safe
 * `owner-must-invite`/`invite` fallback and flags `opennessUnknown: true`
 * (defensive understatement — correct, never changed here). Resolving the
 * pill from `instance.type` alone then paints that guessed tier as fact — a
 * truthful-signals violation (owner law, 2026-08-01). Every pill surface
 * MUST call this instead of indexing `LABEL_KEYS_BY_SCHEME`/`OPENNESS_TIER`
 * directly, so the honest "Unknown" treatment can't drift surface-to-surface.
 *
 * Unknown → the EXISTING neutral pill treatment (`tier: null`, no new token,
 * no glyph) with the scheme-invariant `friends.instance.type.unknown` label
 * (owner design round 2026-08-14, VRX-244) — never a guessed typed label.
 */
export function instancePillFor(
  instance: Pick<InstanceInfo, 'type' | 'opennessUnknown'>,
  labelScheme: LabelScheme
): { labelKey: string; tier: OpennessTier | null } {
  if (instance.opennessUnknown === true) {
    return { labelKey: 'friends.instance.type.unknown', tier: null }
  }
  return {
    labelKey: LABEL_KEYS_BY_SCHEME[labelScheme][instance.type] ?? 'friends.instance.unknownWorld',
    tier: OPENNESS_TIER[instance.type] ?? null
  }
}
