import type {
  CommunityGroup,
  CommunityWorld,
  PersonProfile,
  PersonSummary,
  WorldList
} from '@shared/community'
import type { Platform } from '@shared/types'
import type { ExploreWorldEvidence } from './ExploreAdapter'
import type { RequestLease } from './RequestLease'

export interface CommunityList<T> {
  items: T[]
  /** False when the reply was cut at VRX's cap or unreadable records were skipped. */
  complete: boolean
}

export interface CommunitySearchPage {
  people: PersonSummary[]
  worlds: ExploreWorldEvidence[]
}

/**
 * A narrow, main-only read capability for profiles, search, world lists, the
 * platform's player count, and the user's own groups. It never writes to a
 * platform and does not extend IPlatformAdapter. Every call is user-initiated
 * and waits in the platform's shared admission line. The service owns the
 * lease and passes it to each call so a reply never crosses an account
 * boundary.
 */
export interface CommunityAdapter {
  readonly platform: Platform
  /** Throws when no durable signed-in session exists. */
  captureCommunityLease(): RequestLease
  /** One person's profile, or null when the platform has no such person. */
  getProfile(userId: string, lease: RequestLease): Promise<PersonProfile | null>
  getProfileWorlds(userId: string, lease: RequestLease): Promise<CommunityList<CommunityWorld>>
  getProfileGroups(userId: string, lease: RequestLease): Promise<CommunityList<CommunityGroup>>
  /** People and worlds matching the text. VRChat asks twice, ChilloutVR once. */
  search(query: string, lease: RequestLease): Promise<CommunitySearchPage>
  getWorldList(list: WorldList, lease: RequestLease): Promise<ExploreWorldEvidence[]>
  /** Everyone playing the platform right now, or null when the reply had no count. */
  getPlayersOnline(lease: RequestLease): Promise<number | null>
  getMyGroups(lease: RequestLease): Promise<CommunityList<CommunityGroup>>
}

/** The authenticated reply was structurally unusable. */
export class CommunityDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommunityDataError'
  }
}
