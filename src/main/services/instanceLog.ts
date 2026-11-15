/**
 * The instance log (owner, 2026-11-15): the rooms the signed-in user has been
 * in and who was there with them. VRCX keeps the same record.
 *
 * It is told what happened by a source per platform (`vrchatGameLog.ts` reads
 * VRChat's own log file on this computer; `cvrInstanceWatch.ts` listens to the
 * ChilloutVR connection VRX already holds) and saves it under the account
 * signed in on that platform. It asks no platform for anything.
 *
 * Every step carries the time it happened, and the same step told twice saves
 * nothing twice, so a source may replay a whole game log after a restart.
 * Clearing the log is remembered: a replay never brings back a room from
 * before it.
 */
import type {
  InstanceVisit,
  InstanceVisitPage,
  InstanceVisitPageRequest,
  InstanceVisitPerson,
  MetFacts
} from '@shared/instanceLog'
import { INSTANCE_VISIT_PAGE_SIZE, INSTANCE_VISIT_PEOPLE_MAX } from '@shared/instanceLog'
import type { Platform } from '@shared/types'
import { platformOfAccountKey, type HistoryDatabase } from './historyDatabase'

export interface InstanceLogOptions {
  database: HistoryDatabase
  /** The signed-in account's key on a platform, or null when none is resolved. */
  accountKeyFor: (platform: Platform) => string | null
  /** Read at each step: whether an instance log is kept at all. */
  isSaving: () => boolean
  /** Something the page shows changed. */
  onChanged: () => void
  now?: () => number
}

interface CurrentVisit {
  accountKey: string
  visitId: number
  instanceId: string
}

export class InstanceLog {
  private readonly current = new Map<Platform, CurrentVisit>()
  private readonly now: () => number

  constructor(private readonly options: InstanceLogOptions) {
    this.now = options.now ?? Date.now
  }

  /** Many steps as one write on disk (a game log read at launch). */
  batch(step: () => void): void {
    this.options.database.batch(step)
  }

  /** The user entered a room. Any room they were in before has ended. */
  enter(
    platform: Platform,
    room: { instanceId: string; worldName: string | null; at: number }
  ): void {
    if (room.instanceId === '') return
    const before = this.current.get(platform)
    if (before !== undefined) this.exit(platform, room.at)
    if (!this.options.isSaving()) return
    const accountKey = this.options.accountKeyFor(platform)
    if (accountKey === null) return
    const database = this.options.database
    // A room from before the log was last cleared stays forgotten, however
    // often a source tells it again.
    if (room.at <= database.instanceLogFloor(accountKey)) return
    const visitId = database.openVisit(accountKey, {
      instanceId: room.instanceId,
      worldName: emptyToNull(room.worldName),
      enteredAt: room.at
    })
    if (visitId === null) return
    // An earlier visit whose end was never seen (the game closed without
    // saying so) must not read as "there now" forever.
    database.closeStaleVisits(accountKey, room.at)
    this.current.set(platform, { accountKey, visitId, instanceId: room.instanceId })
    this.options.onChanged()
  }

  /** The room the user is in, or null. */
  currentInstanceId(platform: Platform): string | null {
    return this.live(platform)?.instanceId ?? null
  }

  /** The world's name arrived after the user entered. */
  nameWorld(platform: Platform, worldName: string): void {
    const visit = this.live(platform)
    if (visit === null || worldName.trim() === '') return
    this.options.database.setVisitWorldName(visit.visitId, worldName)
    this.options.onChanged()
  }

  /** Someone is in the room with the user. */
  join(
    platform: Platform,
    person: { platformUserId: string; displayName: string; at: number }
  ): void {
    const visit = this.live(platform)
    if (visit === null || person.platformUserId === '') return
    // The user's own arrival is the visit, not a meeting.
    if (isOwnId(visit.accountKey, person.platformUserId)) return
    this.options.database.encounterJoined(visit.accountKey, visit.visitId, person)
    this.options.onChanged()
  }

  /** Someone left the room. */
  leave(platform: Platform, platformUserId: string, at: number): void {
    const visit = this.live(platform)
    if (visit === null || platformUserId === '') return
    this.options.database.encounterLeft(visit.visitId, platformUserId, at)
    this.options.onChanged()
  }

  /** The user left the room, or the game closed. */
  exit(platform: Platform, at: number): void {
    const visit = this.current.get(platform)
    if (visit === undefined) return
    this.current.delete(platform)
    this.options.database.closeVisit(visit.visitId, at)
    this.options.onChanged()
  }

  /** An account boundary: what follows belongs to whoever signs in. The room
   *  the previous account was in ends at the last moment seen in it. */
  resetPlatform(platform: Platform): void {
    const visit = this.current.get(platform)
    if (visit === undefined) return
    this.current.delete(platform)
    this.options.database.closeStaleVisits(visit.accountKey, null)
    this.options.onChanged()
  }

  /** One page of visits for the accounts signed in right now, newest first. */
  page(request: InstanceVisitPageRequest): InstanceVisitPage {
    const accounts: Array<{ accountKey: string; before: number | null }> = []
    const seen = new Set<Platform>()
    for (const cursor of request.scope) {
      if (seen.has(cursor.platform)) continue
      seen.add(cursor.platform)
      const accountKey = this.options.accountKeyFor(cursor.platform)
      if (accountKey !== null) accounts.push({ accountKey, before: cursor.before })
    }
    // One more than a page, to know whether more are saved.
    const rows = this.options.database.pageVisits({
      accounts,
      limit: INSTANCE_VISIT_PAGE_SIZE + 1
    })
    const visits: InstanceVisit[] = []
    for (const row of rows.slice(0, INSTANCE_VISIT_PAGE_SIZE)) {
      const platform = platformOfAccountKey(row.accountKey)
      if (platform === null) continue
      visits.push({
        id: row.id,
        platform,
        worldName: row.worldName,
        enteredAt: row.enteredAt,
        leftAt: row.leftAt,
        current: this.current.get(platform)?.visitId === row.id,
        people: row.people
      })
    }
    return { visits, hasMore: rows.length > INSTANCE_VISIT_PAGE_SIZE }
  }

  /** Who was there during one visit of the account signed in on `platform`. */
  people(platform: Platform, visitId: number): InstanceVisitPerson[] {
    const accountKey = this.options.accountKeyFor(platform)
    if (accountKey === null) return []
    return this.options.database.visitPeople(accountKey, visitId, INSTANCE_VISIT_PEOPLE_MAX)
  }

  /** What the log says about one person, or null when they were never seen. */
  met(platform: Platform, platformUserId: string): MetFacts | null {
    const accountKey = this.options.accountKeyFor(platform)
    if (accountKey === null) return null
    return this.options.database.metFacts(accountKey, platformUserId)
  }

  /** The page's Clear: forget these platforms' instance log. */
  clear(platforms: readonly Platform[]): void {
    for (const platform of new Set(platforms)) {
      const accountKey = this.options.accountKeyFor(platform)
      if (accountKey === null) continue
      this.current.delete(platform)
      this.options.database.deleteInstanceLog(accountKey, this.now())
    }
    this.options.onChanged()
  }

  /** The user turned activity off, or keeps it only until VRX closes. */
  clearAll(): void {
    this.current.clear()
    this.options.database.deleteAllInstanceLog(this.now())
    this.options.onChanged()
  }

  /** The visit in progress, only while it still belongs to the signed-in account. */
  private live(platform: Platform): CurrentVisit | null {
    const visit = this.current.get(platform)
    if (visit === undefined) return null
    if (!this.options.isSaving()) return null
    return this.options.accountKeyFor(platform) === visit.accountKey ? visit : null
  }
}

function emptyToNull(text: string | null): string | null {
  return text === null || text.trim() === '' ? null : text
}

/** Whether a person's id is the account's own. Account keys are
 *  `<platform>:<id>`; ids compare without regard to letter case. */
function isOwnId(accountKey: string, platformUserId: string): boolean {
  const own = accountKey.slice(accountKey.indexOf(':') + 1)
  return own !== '' && own.toLowerCase() === platformUserId.toLowerCase()
}
