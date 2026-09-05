import type { FriendRef, LinkedProfile } from '@shared/linkedProfiles'
import { FRIEND_SECTIONS } from '@shared/types'
import type { Friend, FriendSection, Platform } from '@shared/types'
import { splitByMatch } from './splitByMatch'

export type ProfileTarget =
  | { kind: 'person'; personId: string; anchor: FriendRef }
  | { kind: 'account'; account: FriendRef; personId: string | null }

export interface LinkedRow {
  key: string
  personKey: string
  target: ProfileTarget
  accounts: Friend[]
  name: string
  section: FriendSection
  platformMark: Platform | 'vrx'
}

export interface ProjectionInput {
  friends: Friend[]
  profiles: LinkedProfile[]
  accountIds: Partial<Record<Platform, string>>
  filter: 'all' | Platform
  search: string
}

export interface Projection {
  rows: LinkedRow[]
  personCount: number
  onlinePeople: number
}

export interface ResolvedProfile {
  target: ProfileTarget
  profile: LinkedProfile | null
  accounts: Friend[]
  header: Friend
  name: string
}

/** Resolve navigation independently of roster filters and presence placement. */
export function resolveLinkedProfile(
  target: ProfileTarget | null,
  input: Pick<ProjectionInput, 'friends' | 'profiles' | 'accountIds'>
): ResolvedProfile | null {
  if (target === null) return null
  const ref = target.kind === 'person' ? target.anchor : target.account
  const profile = input.profiles.find((person) => person.id === target.personId) ?? null
  const accounts: ResolvedAccount[] =
    profile === null
      ? []
      : profile.members.flatMap((member) => {
          if (input.accountIds[member.platform] !== member.platformAccountId) return []
          const friend = input.friends.find(
            (candidate) =>
              candidate.platform === member.platform && candidate.platformUserId === member.friendId
          )
          return friend === undefined
            ? []
            : [{ friend, ref: { platform: member.platform, friendId: member.friendId } }]
        })
  if (target.kind === 'person' && profile !== null) {
    if (accounts.length === 0) return null
    return {
      target,
      profile,
      accounts: accounts.map((account) => account.friend),
      header: anchorFor(accounts, profile.preferredPlatform).friend,
      name: nameFor(profile, accounts)
    }
  }
  // A removed person returns to the original account; an unavailable linked
  // account never borrows its counterpart's data.
  const friend = (
    profile === null ? input.friends : accounts.map((account) => account.friend)
  ).find(
    (candidate) => candidate.platform === ref.platform && candidate.platformUserId === ref.friendId
  )
  if (friend === undefined) return null
  return {
    target: { kind: 'account', account: ref, personId: profile?.id ?? null },
    profile,
    accounts: profile === null ? [friend] : accounts.map((account) => account.friend),
    header: friend,
    name: friend.displayName
  }
}

interface ResolvedAccount {
  friend: Friend
  ref: FriendRef
}

const SECTION_BY_STATE = {
  'in-game': 'in-game',
  active: 'online',
  offline: 'offline'
} as const satisfies Record<Friend['presence']['state'], FriendSection>

const PRESENCE_RANK = { offline: 0, active: 1, 'in-game': 2 } as const

function accountKey(platform: Platform, friendId: string): string {
  return `${platform}\u0000${friendId}`
}

function matchesSearch(values: string[], search: string): boolean {
  const query = search.trim()
  return (
    query === '' || values.some((value) => splitByMatch(value, query).some((part) => part.isMatch))
  )
}

function sectionFor(friend: Friend): FriendSection {
  return SECTION_BY_STATE[friend.presence.state]
}

function anchorFor(accounts: ResolvedAccount[], preferredPlatform: Platform): ResolvedAccount {
  return accounts.reduce((best, candidate) => {
    const candidateRank = PRESENCE_RANK[candidate.friend.presence.state]
    const bestRank = PRESENCE_RANK[best.friend.presence.state]
    if (candidateRank !== bestRank) return candidateRank > bestRank ? candidate : best
    if (
      candidate.friend.platform === preferredPlatform &&
      best.friend.platform !== preferredPlatform
    ) {
      return candidate
    }
    return best
  })
}

function nameFor(profile: LinkedProfile, accounts: ResolvedAccount[]): string {
  if (profile.customName !== null) return profile.customName
  return (
    accounts.find((account) => account.friend.platform === profile.preferredPlatform)?.friend
      .displayName ?? profile.defaultName
  )
}

function combinedPlatformMark(accounts: ResolvedAccount[]): Platform | 'vrx' {
  if (accounts.length === 1) return accounts.at(0)?.friend.platform ?? 'vrx'
  const nonOffline = accounts.filter((account) => account.friend.presence.state !== 'offline')
  return nonOffline.length === 1 ? (nonOffline.at(0)?.friend.platform ?? 'vrx') : 'vrx'
}

function isMixedInGameAndOnline(accounts: ResolvedAccount[]): boolean {
  return (
    accounts.length === 2 &&
    accounts.some((account) => account.friend.presence.state === 'in-game') &&
    accounts.some((account) => account.friend.presence.state === 'active')
  )
}

function sortRows(rows: LinkedRow[]): LinkedRow[] {
  return rows.sort((left, right) => {
    const sectionOrder =
      FRIEND_SECTIONS.indexOf(left.section) - FRIEND_SECTIONS.indexOf(right.section)
    if (sectionOrder !== 0) return sectionOrder
    const nameOrder = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    return nameOrder === 0 ? left.key.localeCompare(right.key) : nameOrder
  })
}

/**
 * Projects account-shaped friend caches into roster rows without fabricating a
 * Friend. Links resolve only when their platform account, platform and friend
 * id all match the current cache scope.
 */
export function projectLinkedFriends(input: ProjectionInput): Projection {
  const friendsByKey = new Map<string, Friend>()
  for (const friend of input.friends) {
    friendsByKey.set(accountKey(friend.platform, friend.platformUserId), friend)
  }

  const consumed = new Set<string>()
  const rows: LinkedRow[] = []

  for (const profile of input.profiles) {
    const accounts: ResolvedAccount[] = []
    for (const member of profile.members) {
      if (input.accountIds[member.platform] !== member.platformAccountId) continue
      const friend = friendsByKey.get(accountKey(member.platform, member.friendId))
      if (friend === undefined) continue
      accounts.push({ friend, ref: { platform: member.platform, friendId: member.friendId } })
    }
    if (accounts.length === 0) continue

    for (const account of accounts)
      consumed.add(accountKey(account.friend.platform, account.friend.platformUserId))
    const aliases = [
      profile.customName ?? '',
      profile.defaultName,
      ...accounts.map((account) => account.friend.displayName)
    ]
    if (!matchesSearch(aliases, input.search)) continue

    const displayed =
      input.filter === 'all'
        ? accounts
        : accounts.filter((account) => account.friend.platform === input.filter)
    if (displayed.length === 0) continue
    const name = nameFor(profile, accounts)
    const personKey = `person:${profile.id}`

    if (input.filter !== 'all' || !isMixedInGameAndOnline(accounts)) {
      if (input.filter !== 'all') {
        const account = displayed.at(0)
        if (account === undefined) continue
        rows.push({
          key: `${personKey}:${account.friend.platform}:${account.friend.platformUserId}`,
          personKey,
          target: { kind: 'account', account: account.ref, personId: profile.id },
          accounts: [account.friend],
          name: account.friend.displayName,
          section: sectionFor(account.friend),
          platformMark: account.friend.platform
        })
      } else {
        const anchor = anchorFor(accounts, profile.preferredPlatform)
        rows.push({
          key: personKey,
          personKey,
          target: { kind: 'person', personId: profile.id, anchor: anchor.ref },
          accounts: displayed.map((account) => account.friend),
          name,
          section: sectionFor(anchor.friend),
          platformMark: combinedPlatformMark(accounts)
        })
      }
      continue
    }

    for (const account of displayed) {
      rows.push({
        key: `${personKey}:${account.friend.platform}:${account.friend.platformUserId}`,
        personKey,
        target: { kind: 'account', account: account.ref, personId: profile.id },
        accounts: [account.friend],
        name: account.friend.displayName,
        section: sectionFor(account.friend),
        platformMark: account.friend.platform
      })
    }
  }

  for (const friend of input.friends) {
    const scopedKey = accountKey(friend.platform, friend.platformUserId)
    if (consumed.has(scopedKey) || (input.filter !== 'all' && input.filter !== friend.platform))
      continue
    if (!matchesSearch([friend.displayName], input.search)) continue
    const accountId = input.accountIds[friend.platform] ?? ''
    const personKey = `account:${friend.platform}:${accountId}:${friend.platformUserId}`
    const account = { platform: friend.platform, friendId: friend.platformUserId }
    rows.push({
      key: personKey,
      personKey,
      target: { kind: 'account', account, personId: null },
      accounts: [friend],
      name: friend.displayName,
      section: sectionFor(friend),
      platformMark: friend.platform
    })
  }

  const sortedRows = sortRows(rows)
  const representedPeople = new Set(sortedRows.map((row) => row.personKey))
  const onlinePeople = new Set(
    sortedRows
      .filter((row) => row.accounts.some((friend) => friend.presence.state !== 'offline'))
      .map((row) => row.personKey)
  )
  return { rows: sortedRows, personCount: representedPeople.size, onlinePeople: onlinePeople.size }
}
