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
import { AuthError } from '../errors'
import { parsePresence } from './parsePresence'
import type { VrcCurrentUserBuckets } from './parsePresence'
import { parseTrustRank } from './parseTrustRank'
import { parseLocation } from './parseLocation'

// ─── Local constants (mirror @shared/constants values — intentionally local
//     to avoid coupling to a file other branches are actively editing) ──────────
const PAGE_SIZE = 100
const MAX_FRIENDS = 5000
/**
 * A pass tolerates transient page failures (skip the window, keep going) but
 * gives up after this many CONSECUTIVE failures — the injected fetcher can't be
 * assumed to have a circuit breaker, and hammering a dead API violates the
 * 1 req/sec etiquette this app lives by (2026-07 audit W4).
 */
const MAX_CONSECUTIVE_PAGE_FAILURES = 3

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

/**
 * Raw friend object from the VRChat /auth/user/friends endpoint. EXPORTED for
 * the Pipeline WS client (VRX-146) — friend events carry the same user shape.
 */
export const rawFriendSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  currentAvatarThumbnailImageUrl: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  statusDescription: z.string().nullable().optional(),
  tags: z.array(z.string()).default([])
})

/**
 * Transport-level page schema: only "the body is an array". Element validation
 * happens HERE, per record (see fetchPass) — NOT in the fetcher's request<T>.
 * Before the 2026-07 audit (W4) this was z.array(rawFriendSchema), so one
 * malformed record of 100 failed the whole page in request<T>, which ALSO
 * recorded a circuit-breaker failure — three drifted pages could lock the
 * adapter out entirely. Data drift must never look like transport failure.
 */
const friendPageSchema = z.array(z.unknown())

export type RawFriend = z.infer<typeof rawFriendSchema>

// ─── Normalizer ───────────────────────────────────────────────────────────────

/**
 * EXPORTED for the Pipeline (VRX-146): WS events normalize through the exact
 * same path as REST; the pipeline passes SYNTHETIC buckets because the event
 * TYPE (online/active/offline) is what carries the presence state there.
 */
export function normalize(raw: RawFriend, buckets: VrcCurrentUserBuckets): VrcFriend {
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
  /** Number of individual records skipped for failing the friend schema (W4). */
  skippedRecords: number
}

// ─── Paginator ────────────────────────────────────────────────────────────────

async function fetchPass(
  fetcher: VrcFetcher,
  offline: boolean,
  buckets: VrcCurrentUserBuckets,
  existing: VrcFriend[],
  counters: { failedPages: number; skippedRecords: number }
): Promise<void> {
  let offset = 0
  let consecutiveFailures = 0

  // Progress invariant: every non-breaking iteration advances `offset` by at
  // least PAGE_SIZE (success or failure), so bounding on offset caps a pass at
  // MAX_FRIENDS/PAGE_SIZE requests even when `existing` never grows — e.g. a
  // misbehaving endpoint returning full pages of schema-drifted records, which
  // would otherwise loop forever: transport succeeds (no failure count, breaker
  // reset) yet every record is skipped (found by the W4 adversarial review).
  while (existing.length < MAX_FRIENDS && offset < MAX_FRIENDS) {
    const path = `/auth/user/friends?offset=${offset}&n=${PAGE_SIZE}&offline=${offline}`
    let page: unknown[]
    try {
      page = await fetcher(path, friendPageSchema)
    } catch (error) {
      // A 401/403 anywhere in the pass (not just the /auth/user probe) means the
      // cookie died mid-fetch — rethrow it so the adapter emits auth-invalidated
      // instead of silently degrading to a partial/empty roster (Codex, VRX-197).
      if (error instanceof AuthError) throw error
      // Skip-and-continue (the api-volatility.md promise): count the failure,
      // skip past the failed window, and try the next page — one transient blip
      // must not discard every page behind it. Give up only after
      // MAX_CONSECUTIVE_PAGE_FAILURES in a row (dead API, don't hammer it).
      counters.failedPages++
      if (++consecutiveFailures >= MAX_CONSECUTIVE_PAGE_FAILURES) break
      offset += PAGE_SIZE
      continue
    }
    consecutiveFailures = 0

    // Per-record validation: one drifted/malformed friend is skipped and
    // counted — the other 99 on the page survive (W4; was all-or-nothing).
    for (const raw of page) {
      if (existing.length >= MAX_FRIENDS) break
      const parsed = rawFriendSchema.safeParse(raw)
      if (!parsed.success) {
        counters.skippedRecords++
        continue
      }
      existing.push(normalize(parsed.data, buckets))
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
 * Caps at MAX_FRIENDS total. Degrades per-unit, never per-pass (W4): a failed
 * page is counted and skipped (the pass continues, giving up only after
 * MAX_CONSECUTIVE_PAGE_FAILURES in a row); a malformed record is counted and
 * skipped (the rest of its page survives). Returns everything collected plus
 * both counters so the caller can distinguish "no friends" from "drift ate them".
 *
 * @param fetcher - Injected HTTP helper (e.g. `(path, schema) => this.get(path, schema)`).
 */
export async function fetchFriends(fetcher: VrcFetcher): Promise<FetchFriendsResult> {
  // Step 1: fetch buckets (graceful degradation on failure → all offline).
  // EXCEPTION: a 401/403 on this session-probe call means the cookie is dead —
  // rethrow it so the adapter can signal auth-invalidated instead of silently
  // degrading to an empty roster while the session is actually gone (VRX-195).
  let buckets: VrcCurrentUserBuckets
  try {
    buckets = await fetcher('/auth/user', currentUserBucketsSchema)
  } catch (error) {
    if (error instanceof AuthError) throw error
    buckets = { onlineFriends: [], activeFriends: [], offlineFriends: [] }
  }

  const friends: VrcFriend[] = []
  const counters = { failedPages: 0, skippedRecords: 0 }

  // Step 2: online pass
  await fetchPass(fetcher, false, buckets, friends, counters)
  // Step 3: offline pass
  await fetchPass(fetcher, true, buckets, friends, counters)

  return { friends, failedPages: counters.failedPages, skippedRecords: counters.skippedRecords }
}
