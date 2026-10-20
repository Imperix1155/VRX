import type { ExplorePlatformSnapshot, ExploreWorld } from '@shared/explore'

/** Popular now hides only when it has no cards and every source settled quietly. */
export function isPopularNowHidden(
  worlds: readonly ExploreWorld[],
  platformSnapshots: readonly ExplorePlatformSnapshot[]
): boolean {
  return (
    worlds.length === 0 &&
    platformSnapshots.every((source) => source.status === 'ready' || source.status === 'idle')
  )
}
