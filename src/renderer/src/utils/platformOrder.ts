import type { Platform } from '@shared/types'

const PLATFORM_DISPLAY_RANK: Record<Platform, number> = { vrchat: 0, chilloutvr: 1 }

/**
 * Display order for anything listed once per platform: VRChat, then
 * ChilloutVR, the same order as the account cards and login tabs. A linked
 * person's members are stored in the order the user linked them, so lists sort
 * for display instead of trusting that order. Returns a sorted copy.
 */
export function inPlatformOrder<T extends { platform: Platform }>(items: readonly [T, T]): [T, T]
export function inPlatformOrder<T extends { platform: Platform }>(items: readonly T[]): T[]
export function inPlatformOrder<T extends { platform: Platform }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => PLATFORM_DISPLAY_RANK[a.platform] - PLATFORM_DISPLAY_RANK[b.platform]
  )
}
