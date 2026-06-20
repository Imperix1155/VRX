import type { TrustRank } from '@shared/types'

/**
 * Map VRChat API tag names to VRX trust ranks (VRX-49).
 *
 * The VRChat tag namespace uses an intentionally offset naming scheme
 * from the display ranks. This parser normalizes `tags: string[]` from
 * the VRChat API into the canonical TrustRank type.
 *
 * Rank hierarchy (highest wins, except nuisance is separate):
 *   visitor < new < user < known < trusted
 *   nuisance (separate flag)
 *
 * No tag present → 'visitor' (default).
 * Multiple trust tags → the highest rank wins.
 * Unknown tags are ignored gracefully.
 */
export function parseTrustRank(tags: string[]): TrustRank {
  if (!Array.isArray(tags) || tags.length === 0) {
    return 'visitor'
  }

  // Check for the separate nuisance flag first
  if (tags.includes('system_probable_troll')) {
    return 'nuisance'
  }

  // Map of trust tags to their ranks (for hierarchy comparison)
  const trustTagRanks: Record<string, number> = {
    system_trust_basic: 1,
    system_trust_known: 2,
    system_trust_trusted: 3,
    system_trust_veteran: 4
  }

  // Find the highest rank among present trust tags
  let highestRank = 0
  let highestTag: string | null = null

  for (const tag of tags) {
    if (tag in trustTagRanks) {
      const rank = trustTagRanks[tag]
      if (rank > highestRank) {
        highestRank = rank
        highestTag = tag
      }
    }
  }

  // Map the highest tag to its display rank
  const rankMap: Record<string, TrustRank> = {
    system_trust_basic: 'new',
    system_trust_known: 'user',
    system_trust_trusted: 'known',
    system_trust_veteran: 'trusted'
  }

  if (highestTag && highestTag in rankMap) {
    return rankMap[highestTag]
  }

  return 'visitor'
}
