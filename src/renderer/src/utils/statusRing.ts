/**
 * Status-ring model (DESIGN.md §9.1 / VRX-207/208) — extracted from FriendsList
 * so the friend drawer (VRX-69) reuses the SAME status fold, never a fork.
 * Kept in a plain util (not a component file) per the react-refresh rule, same
 * reason `instancePill.ts` / `viewTitles.ts` are separate.
 *
 * The ring carries the privacy-tier hue; the avatar's `aria-label` (labelKey)
 * is the row's text signifier, and the drawer's written status band is the
 * long-form non-color signifier (VRX-69 — the badge glyph was retired).
 */
import type { Friend } from '@shared/types'

/**
 * Badge kind per ring. The svg glyphs were retired (VRX-69, owner 2026-07-17 —
 * the badge is now an empty status-color dot); the field still keys badge
 * PRESENCE (null = no badge, e.g. offline) and documents each ring's meaning.
 */
export type GlyphKind = 'check' | 'enter' | 'question' | 'minus' | 'gamepad' | 'dot' | null

export interface Ring {
  colorVar: string
  glyph: GlyphKind
  labelKey: string
}

const STATUS_RING: Record<NonNullable<Friend['status']>, Ring> = {
  'join-me': { colorVar: '--st-joinme', glyph: 'enter', labelKey: 'friends.status.joinMe' },
  online: { colorVar: '--st-online', glyph: 'check', labelKey: 'friends.status.online' },
  'ask-me': { colorVar: '--st-askme', glyph: 'question', labelKey: 'friends.status.askMe' },
  dnd: { colorVar: '--st-dnd', glyph: 'minus', labelKey: 'friends.status.dnd' }
}

// The 'in-game' entry is type-required (exhaustive Record) but unreachable via
// ringFor since VRX-207 folds statusless in-game onto STATUS_RING.online.
const PRESENCE_RING: Record<Friend['presence']['state'], Ring> = {
  'in-game': { colorVar: '--ingame', glyph: 'gamepad', labelKey: 'friends.presence.inGame' },
  active: { colorVar: '--active', glyph: 'dot', labelKey: 'friends.presence.active' },
  offline: { colorVar: '--offline', glyph: null, labelKey: 'friends.presence.offline' }
}

/**
 * The ring for a friend. PRESENCE is evaluated FIRST (VRX-69 review fix of a
 * pre-existing latent bug: the WS friend-offline path retains the cached
 * `status`, so a status-first fold could paint an OFFLINE friend with a live
 * status ring/badge). Offline/web-active always take the presence palette —
 * they are the OTHER §5 axis, never privacy tiers (VRX-208).
 *
 * Only an IN-WORLD friend folds status: VRChat's set status, or for a
 * statusless in-game friend the tier-2 "Online" ring (VRX-207/208: CVR's
 * single online state IS privacy tier 2 — the state palette must not leak
 * into the ring only for CVR, where it read as a broken green next to a
 * VRChat friend in the same state). In-game-ness stays carried by the world
 * subline + instance pill, exactly as it is for VRChat rows.
 */
export function ringFor(friend: Friend): Ring {
  if (friend.presence.state !== 'in-game') return PRESENCE_RING[friend.presence.state]
  if (friend.platform === 'vrchat' && friend.status) return STATUS_RING[friend.status]
  return STATUS_RING.online
}

/**
 * Whether Ask Me / DND should hide the world (DESIGN.md §5 / R6).
 * Only applies to VRChat — CVR has no status — and only while IN A WORLD
 * (Codex re-review, VRX-69: an offline friend with a retained ask-me/dnd
 * status must not read "Offline" + "Hidden" — there is no world to hide).
 */
export function isWorldHidden(friend: Friend): boolean {
  return (
    friend.presence.state === 'in-game' &&
    friend.platform === 'vrchat' &&
    (friend.status === 'ask-me' || friend.status === 'dnd')
  )
}
