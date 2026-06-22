/**
 * VRChat friend list fetcher (VRX-43).
 *
 * Paginates GET /auth/user/friends (online + offline passes),
 * fetches /auth/user once for presence bucket arrays, and normalizes
 * each raw friend into the canonical VrcFriend model.
 *
 * Pure, dependency-injected — no electron/node imports, no HTTP knowledge.
 * The injected `fetcher` is VrcApiClient.get, passed from VrcAdapter.
 * Logging is the caller's responsibility; this module never uses console.*
 */

import { z } from 'zod'
import type { VrcFriend } from '@shared/types'
import { parsePresence } from './parsePresence'
import type { VrcCurrentUserBuckets } from './parsePresence'
import { parseTrustRank } from './parseTrustRank'
import { parseLocation } from './parseLocation'

// ─── Local constants (mirror @shared/constants values — intentionally local
//     to avoid coupling to a file other branches are actively editing) ──────────
const PAGE_SIZE = 100
const MAX_FRIENDS = 5000

// ─── Injected fetcher type ────────────────────────────────────────────────────

/** Shape of the injected HTTP helper (matches VrcApiClient.get). */
export type VrcFetcher = <T>(path: string, schema: z.ZodType<T>) => Promise<T>

// ─── Zod schemas for raw API shapes ──────────────────────────────────────────

/** Minimal current-user shape — only the bucket arrays we need. */
const currentUserBucketsSchema = z.object({
  onlineFriends: z.array(z.string()).default([]),
  activeFriends: z.array(z.string()).default([]),
  offlineFriends: z.array(z.string()).default([])
})

/** Raw friend object from the VRChat /auth/user/friends endpoint. */
const rawFriendSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  currentAvatarThumbnailImageUrl: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  statusDescription: z.string().nullable().optional(),
  tags: z.array(z.string()).default([])
})

const friendPageSchema = z.array(rawFriendSchema)

type RawFriend = z.infer<typeof rawFriendSchema>

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalize(raw: RawFriend, buckets: VrcCurrentUserBuckets): VrcFriend {
  const { state, status, statusDescription } = parsePresence(
    { id: raw.id, status: raw.status, statusDescription: raw.statusDescription },
    buckets
  )

  return {
    platform: 'vrchat',
    platformUserId: raw.id,
    displayName: raw.displayName,
    avatarUrl: raw.currentAvatarThumbnailImageUrl ?? null,
    presence: { state },
    status,
    statusDescription,
    trustRank: parseTrustRank(raw.tags),
    instance: parseLocation(raw.location ?? ''),
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface FetchFriendsResult {
  friends: VrcFriend[]
  /** Number of pages that failed (fetched but errored). Caller may log this. */
  failedPages: number
}

// ─── Paginator ────────────────────────────────────────────────────────────────

async function fetchPass(
  fetcher: VrcFetcher,
  offline: boolean,
  buckets: VrcCurrentUserBuckets,
  existing: VrcFriend[],
  failedPages: { count: number }
): Promise<void> {
  let offset = 0

  while (existing.length < MAX_FRIENDS) {
    const path = `/auth/user/friends?offset=${offset}&n=${PAGE_SIZE}&offline=${offline}`
    let page: RawFriend[]
    try {
      page = await fetcher(path, friendPageSchema)
    } catch {
      failedPages.count++
      break
    }

    for (const raw of page) {
      if (existing.length >= MAX_FRIENDS) break
      existing.push(normalize(raw, buckets))
    }

    // Fewer than PAGE_SIZE items means this was the last page.
    if (page.length < PAGE_SIZE) break
    offset += page.length
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch the complete VRChat friend list for the authenticated user.
 *
 * Steps:
 *   1. GET /auth/user for bucket arrays (needed to derive PresenceState).
 *   2. Paginate online friends (`offline=false`).
 *   3. Paginate offline friends (`offline=true`).
 *
 * Caps at MAX_FRIENDS total. On a page-fetch failure, stops that pass and
 * records the failure count — returns everything collected so far.
 *
 * @param fetcher - Injected HTTP helper (e.g. `(path, schema) => this.get(path, schema)`).
 */
export async function fetchFriends(fetcher: VrcFetcher): Promise<FetchFriendsResult> {
  // Step 1: fetch buckets (graceful degradation on failure → all offline)
  let buckets: VrcCurrentUserBuckets
  try {
    buckets = await fetcher('/auth/user', currentUserBucketsSchema)
  } catch {
    buckets = { onlineFriends: [], activeFriends: [], offlineFriends: [] }
  }

  const friends: VrcFriend[] = []
  const failedPages = { count: 0 }

  // Step 2: online pass
  await fetchPass(fetcher, false, buckets, friends, failedPages)
  // Step 3: offline pass
  await fetchPass(fetcher, true, buckets, friends, failedPages)

  return { friends, failedPages: failedPages.count }
}
