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
import type { AdapterRequestOptions } from '../BaseAdapter'
import { extractCvrPlatformUserId } from './cvrPlatformUserId'

// ─── Injected fetcher type ────────────────────────────────────────────────────

/** Shape of the injected HTTP helper (matches CvrApiClient.get). */
export type CvrFetcher = <T>(
  path: string,
  schema: z.ZodType<T>,
  options?: Pick<AdapterRequestOptions, 'priority'>
) => Promise<T>

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
  /** Friend id → the category ids the roster lists (favorites read these). */
  categories: Map<string, string[]>
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
  // One row per friend: a list that repeats an ID keeps the later record, as
  // the VRChat reader does. The list is one unpaged read, so a repeat says
  // nothing about a missing friend and the roster stays complete.
  const byId = new Map<string, CvrFriend>()
  const categories = new Map<string, string[]>()
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

    byId.set(id.platformUserId, normalize(parsed.data, id.platformUserId))
    if (parsed.data.categories.length > 0) {
      categories.set(id.platformUserId, parsed.data.categories.slice(0, 64))
    } else {
      categories.delete(id.platformUserId)
    }
  }

  return { friends: [...byId.values()], skippedRecords, categories }
}
