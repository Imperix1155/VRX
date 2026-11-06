/**
 * Set home world: one user-pressed write that makes a world the signed-in
 * account's home on its own platform. The renderer names the world by the
 * Explore reference main issued; main keeps the platform's world ID.
 *
 * ⚠️ Pure values and types — bundled into the sandboxed renderer.
 */
import type { Platform } from './types'

/** Spacing between two home-world changes on one platform (a human-paced action). */
export const HOME_WORLD_COOLDOWN_MS = 5_000

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const VRC_WORLD_ID = new RegExp(`^wrld_${GUID}$`, 'i')
const CVR_WORLD_ID = new RegExp(`^${GUID}$`, 'i')

/** Shape check only, so nothing else can reach a request path. */
export function isHomeWorldId(platform: Platform, value: unknown): value is string {
  if (typeof value !== 'string') return false
  return platform === 'vrchat' ? VRC_WORLD_ID.test(value) : CVR_WORLD_ID.test(value)
}

export type SetHomeWorldFailure =
  | 'not-authenticated'
  /** The world reference expired or never came from main. */
  | 'unknown-world'
  | 'cooldown'
  | 'rate-limited'
  | 'failed'

export type SetHomeWorldResult =
  { ok: true; platform: Platform; worldId: string } | { ok: false; reason: SetHomeWorldFailure }
