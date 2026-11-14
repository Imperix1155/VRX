import type { WorldRating, WorldRatingValue } from '@shared/worldRating'
import type { Platform } from '@shared/types'
import type { RequestLease } from './RequestLease'

/**
 * A narrow, main-only capability for the signed-in user's own world rating.
 * It does not extend IPlatformAdapter. Reads follow a world sheet opening;
 * writes follow a Like or Dislike press. The service owns the lease and
 * passes it in so a request never crosses an account boundary. Only VRChat
 * implements it.
 */
export interface WorldRatingAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureWorldRatingLease(): RequestLease
  /** `GET /worlds/{worldId}/rating`. */
  getWorldRating(worldId: string, lease: RequestLease): Promise<WorldRating>
  /** `PUT /worlds/{worldId}/rating` with `{ value }`. Never retried. */
  setWorldRating(
    worldId: string,
    value: WorldRatingValue,
    lease: RequestLease
  ): Promise<WorldRating>
  /** `DELETE /worlds/{worldId}/rating`. Never retried. */
  deleteWorldRating(worldId: string, lease: RequestLease): Promise<WorldRating>
}

/** The world ID failed the shape check, so no request was sent. */
export class WorldRatingIdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorldRatingIdError'
  }
}

/** A signed-in reply was not `{ value: like | dislike | null }`. */
export class WorldRatingDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorldRatingDataError'
  }
}
