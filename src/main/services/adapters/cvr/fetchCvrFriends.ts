/**
 * CVR friend list fetcher (VRX-57).
 *
 * GET /friends returns one flat static roster array: id, name, imageUrl, and
 * category ids. Online state and instance data are deliberately absent here;
 * CVR presence arrives via ONLINE_FRIENDS snapshots in CvrPipeline. This fetcher
 * therefore initializes every roster member as offline with no instance.
 *
 * Pure, dependency-injected: no electron imports and no CvrApiClient dependency.
 * The injected fetcher matches CvrApiClient.get/requestData style: path + data
 * schema, with the CVR envelope already unwrapped by the caller.
 */

import { z } from 'zod'
import type { CvrFriend } from '@shared/types'
import { extractCvrPlatformUserId } from './cvrPlatformUserId'

// ─── Injected fetcher type ────────────────────────────────────────────────────

/** Shape of the injected HTTP helper (matches CvrApiClient.get). */
export type CvrFetcher = <T>(path: string, schema: z.ZodType<T>) => Promise<T>

// ─── Zod schemas for raw API shapes ──────────────────────────────────────────

const cvrRosterSchema = z.array(z.unknown())

const rawCvrFriendSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable().catch(null).optional(),
  categories: z.array(z.string()).catch([]).default([])
})

export type RawCvrFriend = z.infer<typeof rawCvrFriendSchema>

// ─── Result type ──────────────────────────────────────────────────────────────

export interface FetchCvrFriendsResult {
  friends: CvrFriend[]
  /** Number of individual roster entries skipped for malformed critical fields. */
  skippedRecords: number
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalize(raw: RawCvrFriend, platformUserId: string): CvrFriend {
  return {
    platform: 'chilloutvr',
    platformUserId,
    displayName: raw.name,
    avatarUrl: raw.imageUrl ?? null,
    presence: { state: 'offline' },
    status: null,
    statusDescription: null,
    trustRank: null,
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch the complete ChilloutVR friend roster for the authenticated user.
 *
 * Total fetch/envelope failures throw. Per-entry schema failures are skipped and
 * counted so one drifted roster item does not discard the rest of the list.
 */
export async function fetchCvrFriends(fetcher: CvrFetcher): Promise<FetchCvrFriendsResult> {
  const roster = await fetcher('/friends', cvrRosterSchema)
  const friends: CvrFriend[] = []
  let skippedRecords = 0

  for (const entry of roster) {
    const parsed = rawCvrFriendSchema.safeParse(entry)
    if (!parsed.success) {
      skippedRecords++
      continue
    }

    const id = extractCvrPlatformUserId(parsed.data.id)
    if (!id.ok) {
      skippedRecords++
      continue
    }

    friends.push(normalize(parsed.data, id.platformUserId))
  }

  return { friends, skippedRecords }
}
