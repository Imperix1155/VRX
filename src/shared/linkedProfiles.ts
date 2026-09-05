import type { LinkedPersonMember, Platform } from './types'

export interface LinkedProfile {
  id: string
  members: [LinkedPersonMember, LinkedPersonMember]
  customName: string | null
  defaultName: string
  preferredPlatform: Platform
  pictureMode: 'preferred' | 'merged'
  sharedNote: string
  revision: number
}

export interface LinkProfileFile {
  storeFormatVersion: 2
  revision: number
  people: Record<string, LinkedProfile>
}

export type LinkChange =
  | {
      kind: 'replace'
      members: [LinkedPersonMember, LinkedPersonMember]
      preferredPlatform: Platform
      defaultName: string
      expectedPeople: Array<{ id: string; revision: number }>
    }
  | { kind: 'unlink'; personId: string; expectedRevision: number }
  | {
      kind: 'update'
      personId: string
      expectedRevision: number
      patch: Partial<
        Pick<
          LinkedProfile,
          'customName' | 'defaultName' | 'preferredPlatform' | 'pictureMode' | 'sharedNote'
        >
      >
    }

export type LinkFailure = 'invalid' | 'stale' | 'unavailable' | 'storage' | 'rate-limited'
export type LinkResult<T> = { ok: true; value: T } | { ok: false; reason: LinkFailure }
export type FriendRef = { platform: Platform; friendId: string }
export type LinkRequest =
  | {
      kind: 'replace'
      members: [FriendRef, FriendRef]
      preferredPlatform: Platform
      defaultName: string
      expectedPeople: Array<{ id: string; revision: number }>
    }
  | Extract<LinkChange, { kind: 'unlink' | 'update' }>
export type LinkProfileSnapshot = { profiles: LinkedProfile[]; storeRevision: number }
export type LinkSnapshot = LinkProfileSnapshot & { lease: string }
