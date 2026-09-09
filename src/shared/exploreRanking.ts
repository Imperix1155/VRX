import {
  EXPLORE_WORLD_TOTALS,
  type ExploreCount,
  type ExploreFilter,
  type ExploreWorld,
  type ExploreWorldTotal
} from './explore'
import type { Platform } from './types'

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function validNumber(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null
}

function activityValue(platform: Platform, count: ExploreCount): number | null {
  const expected = platform === 'vrchat' ? 'vrc-world-occupants' : 'cvr-public-rooms'
  return count.state === 'complete' &&
    count.source === expected &&
    Number.isSafeInteger(count.value) &&
    count.value >= 0
    ? count.value
    : null
}

function descendingKnown(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return a > b ? -1 : a < b ? 1 : 0
}

function uniqueWorlds(platform: Platform, worlds: readonly ExploreWorld[]): ExploreWorld[] {
  const seen = new Set<string>()
  return worlds.filter((world) => {
    if (world.platform !== platform || !world.worldId || seen.has(world.worldId)) return false
    seen.add(world.worldId)
    return true
  })
}

/** Rank only this platform's bounded candidate set; never compare platform populations. */
export function rankExploreWorlds(
  platform: Platform,
  worlds: readonly ExploreWorld[]
): ExploreWorld[] {
  return uniqueWorlds(platform, worlds).sort((a, b) => {
    const activity = descendingKnown(
      activityValue(platform, a.activity),
      activityValue(platform, b.activity)
    )
    if (activity !== 0) return activity
    if (platform === 'vrchat') {
      const popularity = descendingKnown(validNumber(a.popularity), validNumber(b.popularity))
      return popularity || compareText(a.worldId, b.worldId)
    }
    if (activityValue(platform, a.activity) === null) {
      const aOrder = validNumber(a.sourceOrder) ?? Number.POSITIVE_INFINITY
      const bOrder = validNumber(b.sourceOrder) ?? Number.POSITIVE_INFINITY
      if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1
    }
    return compareText(a.worldId, b.worldId)
  })
}

function compareLists(a: readonly ExploreWorld[], b: readonly ExploreWorld[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const aWorld = a[index]
    const bWorld = b[index]
    if (aWorld && bWorld) {
      const difference = compareText(aWorld.worldId, bWorld.worldId)
      if (difference !== 0) return difference
    }
  }
  return a.length - b.length
}

export interface ExploreSelection {
  /** Each input is already ranked by its own platform's policy. */
  lists: Readonly<Record<Platform, readonly ExploreWorld[]>>
  filter: ExploreFilter
  total: ExploreWorldTotal
  /** Distinct, neutral session assignments. Carry seeds with list identities when swapping. */
  listSeeds: Readonly<Record<Platform, number>>
}

/** Equal shares, alternating pair leaders, then symmetric backfill without placeholders. */
export function selectExploreWorlds({
  lists,
  filter,
  total,
  listSeeds
}: ExploreSelection): ExploreWorld[] {
  if (!EXPLORE_WORLD_TOTALS.includes(total)) throw new RangeError('Invalid Explore total')
  const vrc = uniqueWorlds('vrchat', lists.vrchat)
  const cvr = uniqueWorlds('chilloutvr', lists.chilloutvr)
  if (filter === 'vrchat') return vrc.slice(0, total)
  if (filter === 'chilloutvr') return cvr.slice(0, total)
  if (vrc.length === 0) return cvr.slice(0, total)
  if (cvr.length === 0) return vrc.slice(0, total)

  let comparison = compareLists(vrc, cvr)
  if (comparison === 0) {
    const aSeed = listSeeds.vrchat
    const bSeed = listSeeds.chilloutvr
    if (!Number.isFinite(aSeed) || !Number.isFinite(bSeed) || aSeed === bSeed) {
      throw new RangeError('Indistinguishable Explore lists need distinct finite session seeds')
    }
    comparison = aSeed < bSeed ? -1 : 1
  }
  const leader = comparison < 0 ? vrc : cvr
  const follower = comparison < 0 ? cvr : vrc
  const share = total / 2
  const selected: ExploreWorld[] = []
  for (let rank = 0; rank < share; rank += 1) {
    const pair = rank % 2 === 0 ? [leader[rank], follower[rank]] : [follower[rank], leader[rank]]
    for (const world of pair) if (world) selected.push(world)
  }
  // At most one list can have a deficit after both equal shares were consumed.
  return [...selected, ...leader.slice(share), ...follower.slice(share)].slice(0, total)
}
