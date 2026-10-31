import {
  COMMUNITY_PROFILE_MAX_ITEMS,
  isCommunityUserId,
  type CommunityGroup,
  type CommunityWorld,
  type PersonProfile,
  type PersonSummary,
  type ProfileBadge
} from '@shared/community'
import { imageUrl, record, text, type RecordValue } from '../avatarItemFields'
import type { CommunityList } from '../CommunityAdapter'
import type { ExploreWorldEvidence } from '../ExploreAdapter'
import { parseCvrExploreCandidates } from './parseExplore'

const CVR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** ChilloutVR's placeholder texts for "nothing featured". */
const NO_BADGE = 'No badge featured'

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function picture(raw: RecordValue): string | null {
  return imageUrl(raw.imageUrl) ?? imageUrl(raw.image)
}

/**
 * A person from `/search/{term}` (`type: "user"`) or `/users/{id}`. IDs are
 * lowercased so they match the friends list.
 */
export function parseCvrPerson(value: unknown): PersonSummary | null {
  const raw = record(value)
  if (!raw || !isCommunityUserId('chilloutvr', raw.id)) return null
  const displayName = text(raw.name)
  if (displayName === null) return null
  return {
    platform: 'chilloutvr',
    userId: raw.id.toLowerCase(),
    displayName,
    imageUrl: picture(raw),
    isFriend: typeof raw.isFriend === 'boolean' ? raw.isFriend : null
  }
}

function parseFeaturedBadge(value: unknown): ProfileBadge[] {
  const raw = record(value)
  const name = raw ? text(raw.name) : null
  if (!raw || name === null || name === NO_BADGE) return []
  return [{ name, imageUrl: picture(raw) }]
}

/** `/users/{id}`: the profile fields VRX shows, nothing else. */
export function parseCvrProfile(value: unknown): PersonProfile | null {
  const person = parseCvrPerson(value)
  const raw = record(value)
  if (!person || !raw) return null
  const rank = text(raw.rank)
  return {
    ...person,
    pronouns: text(raw.profilePronouns),
    bio: text(raw.profileBio),
    rank: rank === null ? null : { kind: 'label', value: rank },
    badges: parseFeaturedBadge(raw.featuredBadge)
  }
}

/**
 * `/search/{term}` mixes users, worlds, avatars and props in one array. Only
 * people and worlds are kept, each capped at `max`.
 */
export function parseCvrSearch(
  value: unknown,
  max: number
): { people: PersonSummary[]; worlds: ExploreWorldEvidence[] } | null {
  if (!Array.isArray(value)) return null
  const people: PersonSummary[] = []
  const seen = new Set<string>()
  const worldEntries: unknown[] = []
  for (const entry of value.slice(0, 200)) {
    const raw = record(entry)
    if (!raw || typeof raw.type !== 'string') continue
    const type = raw.type.toLowerCase()
    if (type === 'user' && people.length < max) {
      const person = parseCvrPerson(raw)
      if (person && !seen.has(person.userId)) {
        seen.add(person.userId)
        people.push(person)
      }
    } else if (type === 'world' && worldEntries.length < max) {
      worldEntries.push(raw)
    }
  }
  return { people, worlds: parseCvrExploreCandidates({ entries: worldEntries }) }
}

/** `/users/{id}/worlds`: a person's public worlds, for display only. */
export function parseCvrProfileWorlds(value: unknown): CommunityList<CommunityWorld> | null {
  if (!Array.isArray(value)) return null
  const items: CommunityWorld[] = []
  const seen = new Set<string>()
  let complete = true
  for (const entry of value) {
    const raw = record(entry)
    const name = raw ? text(raw.name) : null
    if (!raw || typeof raw.id !== 'string' || !CVR_ID.test(raw.id) || name === null) {
      complete = false
      continue
    }
    const worldId = raw.id.toLowerCase()
    if (seen.has(worldId)) continue
    seen.add(worldId)
    if (items.length >= COMMUNITY_PROFILE_MAX_ITEMS) {
      complete = false
      break
    }
    items.push({ platform: 'chilloutvr', worldId, name, imageUrl: picture(raw) })
  }
  return { items, complete }
}

function parseGroup(value: unknown, role: CommunityGroup['role']): CommunityGroup | null {
  const raw = record(value)
  const name = raw ? text(raw.name) : null
  if (!raw || typeof raw.id !== 'string' || !CVR_ID.test(raw.id) || name === null) return null
  return {
    platform: 'chilloutvr',
    groupId: raw.id.toLowerCase(),
    name,
    code: text(raw.tag),
    description: text(raw.description),
    imageUrl: imageUrl(raw.image) ?? imageUrl(raw.imageUrl),
    bannerUrl: imageUrl(raw.banner),
    memberCount: count(raw.memberCount),
    role
  }
}

/**
 * `/groups` (own) and `/users/{id}/groups` both answer `{ owned, member }`.
 * `self` marks the signed-in user's own list, where the split gives the role.
 */
export function parseCvrGroups(
  value: unknown,
  self: boolean,
  max: number
): CommunityList<CommunityGroup> | null {
  const raw = record(value)
  if (!raw) return null
  const owned = Array.isArray(raw.owned) ? raw.owned : null
  const member = Array.isArray(raw.member) ? raw.member : null
  if (owned === null && member === null) return null
  const items: CommunityGroup[] = []
  const seen = new Set<string>()
  let complete = true
  const sources: Array<[unknown[], CommunityGroup['role']]> = [
    [owned ?? [], self ? 'owner' : null],
    [member ?? [], self ? 'member' : null]
  ]
  for (const [entries, role] of sources) {
    for (const entry of entries) {
      const group = parseGroup(entry, role)
      if (!group) {
        complete = false
        continue
      }
      if (seen.has(group.groupId)) continue
      seen.add(group.groupId)
      if (items.length >= max) return { items, complete: false }
      items.push(group)
    }
  }
  return { items, complete }
}

/** `/public/userstats`: `{ usersOnline: { overall, public, notConnected, other } }`. */
export function parseCvrPlayersOnline(value: unknown): number | null {
  const raw = record(value)
  const online = raw ? record(raw.usersOnline) : null
  return online ? count(online.overall) : null
}
