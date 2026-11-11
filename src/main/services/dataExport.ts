/**
 * Export friends, notes and favorites to a file (owner, 2026-11-11).
 *
 * Builds one JSON document from what VRX already holds for the signed-in
 * accounts. Nothing here asks a platform for anything: the friends list is the
 * roster VRX last read, the notes and stars come from this computer's store,
 * and in-game favorite groups come from what is loaded. The handler first
 * waits (up to DATA_EXPORT_FAVORITES_WAIT_MS) for the one favorites read VRX
 * makes per sign-in, the same read the Friends page starts; when the groups
 * still are not there, the file and the answer say so.
 *
 * The file never carries a credential, a session, or the user's own account
 * id. Both platforms get the same fields in the same order; a signed-out
 * platform is `null`.
 */
import type { LinkedProfile } from '@shared/linkedProfiles'
import type { Platform } from '@shared/types'

export const DATA_EXPORT_FORMAT = 1
/** Longest an export waits for the once-per-sign-in favorites read. */
export const DATA_EXPORT_FAVORITES_WAIT_MS = 10_000

export interface ExportedPerson {
  id: string
  /** Null when VRX has a note or a star for someone it cannot name right now. */
  name: string | null
  /** Starred in VRX. */
  favorite: boolean
  /** Names of the account's own favorite groups holding them, when loaded. */
  favoriteGroups: string[]
  note: string
}

export interface ExportedWorld {
  id: string
  name: string | null
  favorite: boolean
  favoriteGroups: string[]
}

export interface ExportedPlatform {
  /** False when the friends list had not arrived yet: `friends` then holds only notes and stars. */
  friendsListLoaded: boolean
  /**
   * Whether the account's own favorite groups are in this file: `included`,
   * `off` (Use my game favorites is off), or `unavailable` (they could not be
   * read, so `favoriteGroups` are empty and only VRX's stars are listed).
   */
  gameFavorites: ExportedGameFavorites
  friends: ExportedPerson[]
  favoriteWorlds: ExportedWorld[]
}

export type ExportedGameFavorites = 'included' | 'off' | 'unavailable'

export interface ExportedLink {
  name: string
  vrchatId: string
  chilloutvrId: string
  note: string
}

export interface DataExportFile {
  app: 'VRX'
  format: typeof DATA_EXPORT_FORMAT
  exportedAt: string
  vrchat: ExportedPlatform | null
  chilloutvr: ExportedPlatform | null
  linkedProfiles: ExportedLink[]
}

export interface DataExportCounts {
  friends: number
  notes: number
  favorites: number
}

/** Loaded in-game favorite groups: group names by key, and the keys per id. */
export interface ExportFavoriteGroups {
  groups: { friend: { key: string; name: string }[]; world: { key: string; name: string }[] }
  friends: Record<string, string[]>
  worlds: Record<string, string[]>
  worldNames: { worldId: string; name: string }[]
}

export interface DataExportSources {
  /** The signed-in account for a platform, or null. Used to scope the data, never written. */
  accountId: (platform: Platform) => string | null
  /** Everyone on the loaded friends list, or null before it first arrives. */
  roster: (platform: Platform) => { id: string; name: string }[] | null
  favoriteFriendIds: (platform: Platform) => string[]
  favoriteWorlds: (platform: Platform) => { worldId: string; name: string }[]
  notes: (platform: Platform, accountId: string) => Record<string, string>
  /**
   * Already-loaded in-game favorites, `off` when the setting is off, or
   * `unavailable` when nothing is loaded. Must never start a read.
   */
  gameFavorites: (platform: Platform) => ExportFavoriteGroups | 'off' | 'unavailable'
  linkedProfiles: () => LinkedProfile[]
  now: () => Date
}

export type DataExportBuild =
  | {
      ok: true
      file: DataExportFile
      counts: DataExportCounts
      /** True when a signed-in account's favorite groups could not be included. */
      gameFavoritesMissing: boolean
    }
  /** `signed-out`: no account. `not-ready`: no friends list has arrived yet. */
  | { ok: false; reason: 'signed-out' | 'not-ready' }

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

function byNameThenId<T extends { id: string; name: string | null }>(a: T, b: T): number {
  if (a.name === null && b.name !== null) return 1
  if (a.name !== null && b.name === null) return -1
  return (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id)
}

function groupNames(
  keys: readonly string[] | undefined,
  groups: readonly { key: string; name: string }[]
): string[] {
  if (!keys) return []
  const names: string[] = []
  for (const group of groups) {
    if (keys.includes(group.key)) names.push(group.name)
  }
  return names
}

function exportPlatform(
  platform: Platform,
  accountId: string,
  sources: DataExportSources
): ExportedPlatform {
  const roster = sources.roster(platform)
  const notes = sources.notes(platform, accountId)
  const stars = new Set(sources.favoriteFriendIds(platform))
  const loaded = sources.gameFavorites(platform)
  const game = typeof loaded === 'string' ? null : loaded

  const people = new Map<string, ExportedPerson>()
  const person = (id: string): ExportedPerson => {
    let row = people.get(id)
    if (!row) {
      row = { id, name: null, favorite: false, favoriteGroups: [], note: '' }
      people.set(id, row)
    }
    return row
  }
  for (const friend of roster ?? []) person(friend.id).name = friend.name
  for (const id of stars) person(id).favorite = true
  for (const id of Object.keys(notes)) {
    const note = notes[id]
    if (typeof note === 'string' && note.length > 0) person(id).note = note
  }
  if (game) {
    for (const id of Object.keys(game.friends)) {
      const names = groupNames(game.friends[id], game.groups.friend)
      if (names.length > 0) person(id).favoriteGroups = names
    }
  }

  const worlds = new Map<string, ExportedWorld>()
  const world = (id: string): ExportedWorld => {
    let row = worlds.get(id)
    if (!row) {
      row = { id, name: null, favorite: false, favoriteGroups: [] }
      worlds.set(id, row)
    }
    return row
  }
  for (const starred of sources.favoriteWorlds(platform)) {
    const row = world(starred.worldId)
    row.name = starred.name
    row.favorite = true
  }
  if (game) {
    for (const known of game.worldNames) {
      const names = groupNames(game.worlds[known.worldId], game.groups.world)
      if (names.length === 0) continue
      const row = world(known.worldId)
      row.name ??= known.name
      row.favoriteGroups = names
    }
    for (const id of Object.keys(game.worlds)) {
      const names = groupNames(game.worlds[id], game.groups.world)
      if (names.length > 0) world(id).favoriteGroups = names
    }
  }

  return {
    friendsListLoaded: roster !== null,
    gameFavorites: typeof loaded === 'string' ? loaded : 'included',
    friends: [...people.values()].sort(byNameThenId),
    favoriteWorlds: [...worlds.values()].sort(byNameThenId)
  }
}

/** Build the export from what VRX holds right now. Pure apart from its sources. */
export function buildDataExport(sources: DataExportSources): DataExportBuild {
  const accounts: Record<Platform, string | null> = {
    vrchat: sources.accountId('vrchat'),
    chilloutvr: sources.accountId('chilloutvr')
  }
  const signedIn = PLATFORMS.filter((platform) => accounts[platform] !== null)
  if (signedIn.length === 0) return { ok: false, reason: 'signed-out' }

  const sections: Record<Platform, ExportedPlatform | null> = { vrchat: null, chilloutvr: null }
  for (const platform of signedIn) {
    sections[platform] = exportPlatform(platform, accounts[platform] as string, sources)
  }
  if (signedIn.every((platform) => sections[platform]?.friendsListLoaded === false)) {
    return { ok: false, reason: 'not-ready' }
  }

  // A link is exported only when both of its people belong to the accounts signed in now.
  const linkedProfiles: ExportedLink[] = []
  for (const profile of sources.linkedProfiles()) {
    const vrchat = profile.members.find((member) => member.platform === 'vrchat')
    const chilloutvr = profile.members.find((member) => member.platform === 'chilloutvr')
    if (!vrchat || !chilloutvr) continue
    if (vrchat.platformAccountId !== accounts.vrchat) continue
    if (chilloutvr.platformAccountId !== accounts.chilloutvr) continue
    linkedProfiles.push({
      name: profile.customName ?? profile.defaultName,
      vrchatId: vrchat.friendId,
      chilloutvrId: chilloutvr.friendId,
      note: profile.sharedNote
    })
  }
  linkedProfiles.sort(
    (a, b) => a.name.localeCompare(b.name) || a.vrchatId.localeCompare(b.vrchatId)
  )

  const counts: DataExportCounts = { friends: 0, notes: 0, favorites: 0 }
  for (const platform of signedIn) {
    const section = sections[platform]
    if (!section) continue
    for (const row of section.friends) {
      if (row.name !== null) counts.friends += 1
      if (row.note.length > 0) counts.notes += 1
      if (row.favorite || row.favoriteGroups.length > 0) counts.favorites += 1
    }
    counts.favorites += section.favoriteWorlds.length
  }
  counts.notes += linkedProfiles.filter((link) => link.note.length > 0).length

  return {
    ok: true,
    file: {
      app: 'VRX',
      format: DATA_EXPORT_FORMAT,
      exportedAt: sources.now().toISOString(),
      vrchat: sections.vrchat,
      chilloutvr: sections.chilloutvr,
      linkedProfiles
    },
    counts,
    gameFavoritesMissing: signedIn.some(
      (platform) => sections[platform]?.gameFavorites === 'unavailable'
    )
  }
}

/** `vrx-export-2026-11-11.json`, from the local date. */
export function dataExportFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `vrx-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

export function serializeDataExport(file: DataExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}
