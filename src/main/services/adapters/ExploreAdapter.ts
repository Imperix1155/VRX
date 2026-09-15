import type { ExploreJoinDenial, ExploreRoom, ExploreWorld } from '@shared/explore'
import type { Platform } from '@shared/types'
import type { RequestPriority } from './BaseAdapter'
import type { RequestLease } from './RequestLease'

/** Discovery evidence has no renderer-visible action or selection reference. */
export type ExploreWorldEvidence = Omit<ExploreWorld, 'worldRef'>

/** Main attaches an action only after it has rechecked the retained evidence. */
export interface ExploreRoomEvidence extends Omit<ExploreRoom, 'action'> {
  joinEligibility: 'eligible' | ExploreJoinDenial
}

export interface ExploreWorldDetail {
  world: ExploreWorldEvidence
  roomIds: string[]
  roomsComplete: boolean
}

/** The discovery service owns this operation and supplies its existing lease. */
export interface ExploreRequestContext {
  lease: RequestLease
  signal: AbortSignal
  priority: RequestPriority
  beforeDispatch: () => void
}

/** A deliberately narrow, main-only read capability; it does not extend IPlatformAdapter. */
export interface ExploreAdapter {
  readonly platform: Platform
  captureExploreLease(): RequestLease
  getExploreCandidates(context: ExploreRequestContext): Promise<ExploreWorldEvidence[]>
  getExploreWorld(
    worldId: string,
    context: ExploreRequestContext
  ): Promise<ExploreWorldDetail | null>
  getExploreRoom(
    target: { worldId: string; instanceId: string },
    context: ExploreRequestContext
  ): Promise<ExploreRoomEvidence | null>
}

/** The authenticated response was structurally unusable for the requested evidence. */
export class ExploreDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExploreDataError'
  }
}
