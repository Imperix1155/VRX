/**
 * Instance-pill constants (VRX-198) — kept in a plain util (not the component file)
 * so `InstancePill.tsx` exports ONLY its component (react-refresh rule, same reason
 * `viewTitles.ts` / `segmented.ts` are separate).
 */
import type { InstanceType } from '@shared/types'

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
